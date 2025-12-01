# Chat View Permission Display - Manual Test Guide

## Test Scenario 1: Permission Matches Tool (Embedded Display)

**Expected**: Permission card appears INSIDE tool card

1. Start new conversation
2. Trigger tool that requests permission (e.g., file read)
3. Verify permission card appears INSIDE the tool-call-item card
4. Verify Allow/Deny/Always buttons work
5. Verify countdown timer displays
6. Verify permission disappears after response

**Pass Criteria**: Permission embedded in tool card, no fallback shown

---

## Test Scenario 2: Permission Doesn't Match Tool (Fallback Display)

**Expected**: Permission card appears in FALLBACK section above input

**Setup**: Simulate ID mismatch by modifying toolUseId in DevTools or backend

1. Start conversation that triggers permission
2. Verify warning section appears above chat input
3. Verify permission card displays with warning icon
4. Verify Allow/Deny/Always buttons work
5. Verify permission disappears after response

**Pass Criteria**: Fallback section visible, permission functional

---

## Test Scenario 3: Race Condition (Permission Before Tool)

**Expected**: Permission appears when tool node arrives (reactive)

**Setup**: Add artificial delay to tool node creation

1. Trigger permission-requiring tool
2. Permission should appear in fallback initially (if tool not rendered yet)
3. Once tool node renders, permission should move to embedded location
4. Verify no duplicate permission cards

**Pass Criteria**: Permission always visible somewhere, moves when tool appears

---

## Test Scenario 4: Multiple Permissions Simultaneously

**Expected**: Mix of embedded and fallback as appropriate

1. Trigger multiple tools with permissions at once
2. Verify each permission displays correctly (embedded or fallback)
3. Verify responding to one doesn't affect others
4. Verify all disappear after responses

**Pass Criteria**: All permissions visible, all functional independently

---

## Visual Regression Checks

**Fallback UI Styling**:

- Warning border: `border-warning/20`
- Warning background: `bg-warning/5`
- Warning icon color: `text-warning/80`
- Proper spacing: `px-4 pb-2` for container, `mb-2 pt-2` for header

**Embedded UI Styling**:

- Should maintain existing tool card styles
- No visual conflicts with fallback UI

---

## Debug Console Validation

When running tests, check browser DevTools console for:

1. `[ChatStore] Permission lookup miss:` - Appears when IDs don't match
2. `lookupKey` - Should show the toolCallId being searched
3. `availableKeys` - Should show all toolUseIds from permissions
4. `pendingCount` - Should show number of pending permissions

**Expected Console Output Example**:

```
[ChatStore] Permission lookup miss: {
  lookupKey: "tool_abc123",
  availableKeys: ["tool_xyz789"],
  pendingCount: 1
}
```

---

## Edge Cases to Verify

- [ ] Permission with no toolUseId always shows in fallback
- [ ] Permission timeout auto-deny still works in both locations
- [ ] Tab switch during permission request preserves state
- [ ] Multiple rapid permissions don't cause race conditions
- [ ] Fallback section disappears when all permissions resolved
