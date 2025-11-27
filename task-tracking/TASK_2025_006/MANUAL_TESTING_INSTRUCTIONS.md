# MANUAL TESTING INSTRUCTIONS - TASK_2025_006

**Status**: ✅ Ready for Manual Testing (Automated checks complete)
**Date**: 2025-11-19
**Commit**: 70208d8 (All TypeScript errors fixed)

---

## 🎯 TESTING OBJECTIVE

Verify that all 15 CLAUDE_DOMAIN_EVENTS are properly forwarded from backend EventBus to frontend webview, and that all 4 UI components (ThinkingDisplay, ToolTimeline, PermissionDialog, AgentTimeline) function correctly.

---

## ✅ PRE-FLIGHT CHECKLIST (ALREADY COMPLETE)

These automated checks have been verified by senior-tester:

- [x] Build succeeds: `npm run build:all` - **PASS** (10s)
- [x] TypeScript compilation: `npm run typecheck:all` - **PASS** (0 errors)
- [x] ClaudeEventRelayService created and registered
- [x] Service initialized in PtahExtension.initialize()
- [x] 4 UI components created (TypeScript + templates)
- [x] ChatService has 12 event subscriptions
- [x] ChatService has 6 signal state properties

**Infrastructure Status**: ✅ READY - All build/typecheck automated tests pass

---

## 📋 MANUAL TESTING PROTOCOL

**Estimated Time**: 1-2 hours
**Required**: Human user with VS Code open

### Phase 1: Extension Launch (15 minutes)

#### Step 1.1: Build Extension

```bash
cd D:/projects/ptah-extension
npm run build:all
```

**Expected**: Build completes successfully (warning about bundle size is non-blocking)

#### Step 1.2: Launch Extension Development Host

1. Open VS Code at `D:/projects/ptah-extension`
2. Press **F5** (Start Debugging)
3. Wait for new window titled "[Extension Development Host]"

**Expected**:

- New VS Code window opens
- Extension activates without errors
- No red error notifications

#### Step 1.3: Verify Backend Logs

1. In **main** VS Code window (not Extension Development Host)
2. **View → Output** → Select "Ptah Extension" from dropdown
3. Look for initialization messages

**Expected Output**:

```
[INFO] Initializing Ptah extension...
[INFO] WebviewMessageBridge initialized
[INFO] [ClaudeEventRelay] Initializing event relay subscriptions...
[INFO] Initialized 15 event relay subscriptions
[INFO] Ptah extension initialized successfully
```

**Validation**:

- [ ] Extension Development Host opens
- [ ] Backend logs show ClaudeEventRelay initialization
- [ ] "15 event relay subscriptions" message appears
- [ ] No errors in backend logs

#### Step 1.4: Open Chat Panel

1. In Extension Development Host window
2. **Ctrl+Shift+P** → "Ptah: Quick Chat" or "Ptah: Open Full Panel"
3. Chat panel opens

**Expected**:

- Chat interface renders
- Input box visible
- No errors

#### Step 1.5: Open Webview DevTools

1. With chat panel open, click inside webview area
2. Press **Ctrl+Shift+I**
3. Navigate to Console tab

**Expected**:

- DevTools open
- No red errors in console
- Angular application loaded

**Validation**:

- [ ] Chat panel opens successfully
- [ ] Webview DevTools accessible
- [ ] No console errors
- [ ] Angular loaded

---

### Phase 2: Component Testing (60 minutes)

Create directory for screenshots:

```bash
mkdir -p task-tracking/TASK_2025_006/screenshots
```

---

#### Test A: ThinkingDisplayComponent (10 minutes)

**Objective**: Verify thinking display appears and shows Claude's reasoning

**Steps**:

1. In chat, send: **"Explain how the QuickSort algorithm works step by step, including detailed time complexity analysis"**
2. Observe UI during response

**Look For**:

- 💭 icon or similar thinking indicator
- Thinking content panel
- Claude's reasoning text
- Panel hides after thinking completes

**Screenshot**:

- Capture: `screenshots/thinking-display.png`
- Include: Thinking panel visible with reasoning text

**Validation Checklist**:

- [ ] Thinking component appears automatically
- [ ] Shows 💭 icon
- [ ] Displays reasoning content (not empty)
- [ ] Uses VS Code theme colors
- [ ] Component hides after completion

---

#### Test B: ToolTimelineComponent (20 minutes)

**Objective**: Verify tool execution timeline tracks all tool types

**Test B.1 - Read Tool Success**:

1. Send: **"Read the package.json file and tell me the project name"**
2. Observe tool timeline

**Look For**:

- Tool timeline component appears
- "Read" tool with 📖 icon
- Status: ⏳ (running) → ✅ (success)
- Duration (e.g., "125ms")

**Screenshot**: `screenshots/tool-timeline-read-success.png`

**Test B.2 - Bash Tool**:

1. Send: **"Run the command 'npm list --depth=0' and show the output"**
2. Observe "Bash" tool with ⚡ icon

**Screenshot**: `screenshots/tool-timeline-bash.png`

**Test B.3 - Write Tool**:

1. Send: **"Create a file named test-relay.txt with content 'Event relay test'"**
2. Observe "Write" tool with ✍️ icon

**Screenshot**: `screenshots/tool-timeline-write.png`

**Test B.4 - Error Handling**:

1. Send: **"Read the file at /nonexistent/path/file.txt"**
2. Observe error state

**Look For**:

- "Read" tool appears
- Status: ⏳ → ❌ (error)
- Error message displays

**Screenshot**: `screenshots/tool-timeline-error.png`

**Validation Checklist**:

- [ ] Read tool displays with correct icon
- [ ] Bash tool displays with correct icon
- [ ] Write tool displays with correct icon
- [ ] Status transitions work (⏳ → ✅ / ❌)
- [ ] Duration calculated and shown
- [ ] Error state displays message
- [ ] Multiple tools can display simultaneously

---

#### Test C: PermissionDialogComponent (15 minutes)

**Objective**: Verify permission dialogs display and handle user response

**Test C.1 - Approve Permission**:

1. Send: **"Write a hello world program to hello.js"**
2. Permission dialog appears

**Look For**:

- Modal overlay (dims background)
- Permission type (e.g., "File Write")
- Tool name ("Write")
- File path ("hello.js")
- Buttons: "Approve", "Deny", "Always Allow"

3. Click **"Approve"**

**Expected**:

- Dialog dismisses
- File write completes
- hello.js created

**Screenshot**: `screenshots/permission-dialog-approve.png`

**Test C.2 - Deny Permission**:

1. Send: **"Delete the file test-relay.txt"**
2. Click **"Deny"**

**Expected**:

- Dialog dismisses
- File NOT deleted
- Backend logs denial

**Screenshot**: `screenshots/permission-dialog-deny.png`

**Test C.3 - Bash Permission**:

1. Send: **"Run 'git status' command"**
2. Approve permission
3. Verify command executes

**Screenshot**: `screenshots/permission-dialog-bash.png`

**Validation Checklist**:

- [ ] Dialog appears as modal overlay
- [ ] Shows permission type, tool, path
- [ ] "Approve" works and dismisses dialog
- [ ] "Deny" works and blocks action
- [ ] Dialog styled with VS Code theme
- [ ] Multiple permission requests queue properly

---

#### Test D: AgentTimelineComponent (15 minutes)

**Objective**: Verify agent timeline displays for orchestrated workflows

**⚠️ NOTE**: Requires `/orchestrate` command with sub-agents

**Test D.1 - Single Agent**:

1. Send: **"/orchestrate analyze the project structure"**
2. Observe agent timeline

**Look For**:

- Agent timeline component
- Agent name (e.g., "workflow-orchestrator", "researcher-expert")
- Status: ⏳ (running) → ✅ (completed)
- Agent description/activity
- Duration on completion
- Result summary (if available)

**Screenshot**: `screenshots/agent-timeline-single.png`

**Test D.2 - Multiple Agents**:

1. Send: **"/orchestrate implement a simple calculator function"**
2. Observe multiple agents

**Expected Agents**:

- workflow-orchestrator
- project-manager or researcher-expert
- software-architect (maybe)
- backend-developer or junior-developer

**Look For**:

- Each agent displays independently
- Status updates independently
- Completion order tracked
- No overlap or layout issues

**Screenshot**: `screenshots/agent-timeline-multiple.png`

**Validation Checklist**:

- [ ] Agent timeline appears for `/orchestrate`
- [ ] Agent name displays correctly
- [ ] Running status (⏳) visible
- [ ] Completed status (✅) visible
- [ ] Duration calculated
- [ ] Multiple agents display without overlap
- [ ] Agent activities update

**If `/orchestrate` Not Available**:

- Document: "Agent timeline cannot be tested - /orchestrate command not functional"
- Mark as limitation, not blocker

---

### Phase 3: Cross-Cutting Tests (30 minutes)

---

#### Test E: VS Code Theme Compatibility (10 minutes)

**Objective**: Verify components adapt to VS Code themes

**Test E.1 - Dark Theme**:

1. **File → Preferences → Color Theme → "Dark+ (default dark)"**
2. Trigger all 4 components (send complex message)
3. Verify:
   - Text readable (sufficient contrast)
   - Colors use --vscode-\* CSS variables
   - No hardcoded colors
   - Borders/backgrounds adapt

**Screenshot**: `screenshots/theme-dark.png`

**Test E.2 - Light Theme**:

1. Switch to **"Light+ (default light)"**
2. Verify components adapt
3. Verify readability

**Screenshot**: `screenshots/theme-light.png`

**Test E.3 - High Contrast** (bonus):

1. Switch to **"High Contrast"** theme
2. Verify accessibility

**Screenshot**: `screenshots/theme-high-contrast.png` (optional)

**Validation Checklist**:

- [ ] Dark theme: All components readable
- [ ] Light theme: All components readable
- [ ] Automatic theme adaptation (no refresh)
- [ ] No hardcoded colors visible
- [ ] Sufficient contrast in all themes

---

#### Test F: Integration & Stress Testing (20 minutes)

**Test F.1 - All Components Simultaneously**:

1. Send: **"/orchestrate create a REST API endpoint with database integration"**
2. Observe all 4 components

**Expected**:

- Thinking display (agent reasoning)
- Tool timeline (Read, Write, Edit)
- Permission dialogs (file writes)
- Agent timeline (multiple agents)

**Verify**:

- [ ] All components visible without overlap
- [ ] Smooth scrolling
- [ ] Each component updates independently
- [ ] No performance lag/jank

**Screenshot**: `screenshots/integration-all-components.png`

**Test F.2 - Session Cleanup**:

1. Complete workflow from F.1
2. Click "New Session" or create new chat
3. Verify all components clear:
   - No stale thinking
   - Tool timeline empty
   - No pending permissions
   - Agent timeline empty
4. Send new message
5. Verify fresh state

**Validation**:

- [ ] Session cleanup clears all components
- [ ] New session starts fresh
- [ ] No stale state visible

**Test F.3 - Rapid Messages (Stress Test)**:

1. Send 4 messages quickly:
   - "Read package.json"
   - "List files in src/"
   - "Show main entry point"
   - "Analyze structure"
2. Verify:
   - [ ] UI handles concurrent events
   - [ ] No race conditions
   - [ ] All tools display
   - [ ] No state corruption

**Test F.4 - Memory Leak Check**:

1. Open DevTools → **Memory** tab
2. Take heap snapshot (baseline)
3. Execute 10-15 messages
4. Take another snapshot
5. Compare memory
6. Look for detached DOM nodes

**Validation**:

- [ ] Memory usage stable (< 50MB growth)
- [ ] No detached DOM nodes
- [ ] No unreleased subscriptions

**Test F.5 - Error Recovery**:

1. Trigger error (read non-existent file)
2. Verify error displays
3. Send normal message
4. Verify system recovers

**Validation**:

- [ ] Error displays in tool timeline
- [ ] System functional after error
- [ ] No permanent errors

---

### Phase 4: Event Coverage Validation (15 minutes)

**Objective**: Verify all 15 CLAUDE_DOMAIN_EVENTS are forwarded

**Event Coverage Checklist**:

| Event                | Test Action      | Expected UI        | Status |
| -------------------- | ---------------- | ------------------ | ------ |
| CONTENT_CHUNK        | Any message      | Progressive text   | [ ]    |
| THINKING             | Complex prompt   | Thinking display   | [ ]    |
| TOOL_START           | File operation   | Tool ⏳ status     | [ ]    |
| TOOL_PROGRESS        | Long tool        | Progress update    | [ ]    |
| TOOL_RESULT          | Tool completes   | Tool ✅ status     | [ ]    |
| TOOL_ERROR           | Invalid path     | Tool ❌ status     | [ ]    |
| PERMISSION_REQUESTED | File write       | Dialog appears     | [ ]    |
| PERMISSION_RESPONDED | Approve/Deny     | Dialog dismisses   | [ ]    |
| AGENT_STARTED        | `/orchestrate`   | Agent in timeline  | [ ]    |
| AGENT_ACTIVITY       | Agent uses tools | Activity updates   | [ ]    |
| AGENT_COMPLETED      | Agent finishes   | Agent ✅ status    | [ ]    |
| SESSION_INIT         | First message    | Backend log        | [ ]    |
| SESSION_END          | End session      | Backend log        | [ ]    |
| HEALTH_UPDATE        | Startup          | Health status      | [ ]    |
| CLI_ERROR            | Invalid command  | Error notification | [ ]    |

**Target**: 15/15 events functional (100% coverage)

**Verification**:

- Check backend logs: **View → Output → Ptah Extension**
- Check webview console: **DevTools → Console**
- Look for event relay log messages

---

## 📊 TEST REPORTING

### Update test-results.md

After completing all tests, update `task-tracking/TASK_2025_006/test-results.md`:

1. Fill in all [ ] checkboxes
2. Add performance observations
3. Document any issues found
4. Add console log excerpts
5. Verify acceptance criteria

### Screenshot Checklist

Ensure you have captured:

**Required (10 screenshots minimum)**:

- [ ] `screenshots/thinking-display.png`
- [ ] `screenshots/tool-timeline-read-success.png`
- [ ] `screenshots/tool-timeline-bash.png`
- [ ] `screenshots/tool-timeline-write.png`
- [ ] `screenshots/tool-timeline-error.png`
- [ ] `screenshots/permission-dialog-approve.png`
- [ ] `screenshots/permission-dialog-deny.png`
- [ ] `screenshots/agent-timeline-single.png` (if /orchestrate works)
- [ ] `screenshots/theme-dark.png`
- [ ] `screenshots/theme-light.png`

**Optional (bonus)**:

- [ ] `screenshots/permission-dialog-bash.png`
- [ ] `screenshots/agent-timeline-multiple.png`
- [ ] `screenshots/theme-high-contrast.png`
- [ ] `screenshots/integration-all-components.png`

---

## 🐛 ISSUE REPORTING

### If You Find Issues

Document in test-results.md under "Issues Discovered":

```markdown
### Issue #N: [Title]

**Severity**: Critical / High / Medium / Low
**Component**: [Component name]
**Steps to Reproduce**:

1. Step 1
2. Step 2
3. ...

**Expected**: [Expected behavior]
**Actual**: [Actual behavior]
**Screenshot**: `screenshots/issue-N.png`
**Console Errors**: [Error messages]
```

**Critical Issues**: Stop testing and escalate to backend-developer or frontend-developer

---

## ✅ FINAL CHECKLIST

Before marking testing complete:

### Documentation

- [ ] test-results.md updated with all results
- [ ] All checkboxes marked (pass/fail)
- [ ] Screenshots captured (10+ minimum)
- [ ] Issues documented (if any)
- [ ] Performance observations added
- [ ] Console logs included

### Acceptance Criteria

- [ ] All 15 events forwarded (verify in logs)
- [ ] All 4 components functional (manual verification)
- [ ] No console errors during testing
- [ ] Theme compatibility verified (dark + light)
- [ ] Session cleanup works
- [ ] No memory leaks

### Git Commit

```bash
git add task-tracking/TASK_2025_006/test-results.md
git add task-tracking/TASK_2025_006/screenshots/
git commit -m "docs(testing): complete event relay system manual testing

- task 5.1: build and launch verified
- task 5.2: all 6 test categories executed (a-f)
- task 5.3: end-to-end validation complete

event coverage: 15/15 events tested (100%)
screenshots: 10+ captured and documented"
```

---

## 🎯 SUCCESS CRITERIA

**Batch 5 is COMPLETE when**:

1. ✅ Extension builds and launches (Task 5.1)
2. ✅ All 6 test categories executed (Task 5.2)
3. ✅ Minimum 10 screenshots captured
4. ✅ Event flow verified end-to-end (Task 5.3)
5. ✅ All checklists completed
6. ✅ test-results.md updated
7. ✅ Git commit created

**Overall Task Success**:

- 15/15 events forwarded (100% coverage)
- 4/4 components functional
- No critical blockers
- Professional testing documentation

---

## 📞 HELP & ESCALATION

**If You Get Stuck**:

1. **Build failures**: Re-run `npm run build:all`
2. **Extension won't launch**: Check VS Code Output for errors
3. **Components not appearing**: Check webview console for errors
4. **Events not forwarding**: Check backend logs for [ClaudeEventRelay] messages

**Escalate If**:

- Critical errors prevent testing
- More than 3 components completely broken
- Extension crashes or freezes
- Cannot capture basic functionality

**Contact**: Create detailed issue report and assign back to senior-tester or team-leader

---

## 🎉 READY TO TEST

**Infrastructure Status**: ✅ READY
**Test Protocol**: ✅ DOCUMENTED
**Estimated Time**: 1-2 hours

**You may now begin manual testing following this protocol.**

Good luck! 🚀
