# Batch B2 report — F2, F3 (TASK_2026_376)

Files touched (write boundary respected, no other files touched):

- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts`

## F3 — empty assistant bubbles

Guarded the text branch the same way the thinking branch is guarded: an
empty-string `text` block no longer pushes a `TextDeltaEvent`. A message left
with zero events falls through to the existing `events.length === 0` skip
path unchanged. `blockIndex: contentIndex` semantics are unchanged for blocks
that do emit — the index still tracks position in the content array, not a
running counter.

## F2 — background agent card terminalises early

Moved the `background_agent_started` construction and push above the
`tool_result` construction and push, inside the same `isToolResultBlock`
branch, for the same tool_use id. Every field on both events is unchanged.
The `state.removeBackgroundTaskToolUseId` call and the existing debug log
stay in place, unchanged. No frontend file touched.

## Diff applied

```diff
diff --git a/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts b/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts
index d90bf8bfd..505c911af 100644
--- a/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts
+++ b/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts
@@ -133,18 +133,20 @@ export class AssistantMessageTransformer {
           events.push(thinkingDeltaEvent);
         }
       } else if (isTextBlock(block)) {
-        const textDeltaEvent: TextDeltaEvent = {
-          id: generateEventId(),
-          eventType: 'text_delta',
-          timestamp: Date.now(),
-          sessionId,
-          source: 'complete' as EventSource,
-          messageId,
-          delta: block.text,
-          blockIndex: contentIndex,
-          parentToolUseId: parent_tool_use_id ?? undefined,
-        };
-        events.push(textDeltaEvent);
+        if (block.text) {
+          const textDeltaEvent: TextDeltaEvent = {
+            id: generateEventId(),
+            eventType: 'text_delta',
+            timestamp: Date.now(),
+            sessionId,
+            source: 'complete' as EventSource,
+            messageId,
+            delta: block.text,
+            blockIndex: contentIndex,
+            parentToolUseId: parent_tool_use_id ?? undefined,
+          };
+          events.push(textDeltaEvent);
+        }
       } else if (isToolUseBlock(block)) {
         const isTaskTool = isAgentDispatchTool(block.name);

@@ -272,20 +274,6 @@ export class AssistantMessageTransformer {

         events.push(toolStartEvent);
       } else if (isToolResultBlock(block)) {
-        const toolResultEvent: ToolResultEvent = {
-          id: generateEventId(),
-          eventType: 'tool_result',
-          timestamp: Date.now(),
-          sessionId,
-          source: 'complete' as EventSource,
-          messageId,
-          toolCallId: block.tool_use_id,
-          output: block.content,
-          isError: block.is_error ?? false,
-          parentToolUseId: parent_tool_use_id ?? undefined,
-        };
-        events.push(toolResultEvent);
-
         if (state.hasBackgroundTaskToolUseId(block.tool_use_id)) {
           const bgEvent = buildBackgroundAgentStartedEvent({
             toolCallId: block.tool_use_id,
@@ -309,6 +297,20 @@ export class AssistantMessageTransformer {
             },
           );
         }
+
+        const toolResultEvent: ToolResultEvent = {
+          id: generateEventId(),
+          eventType: 'tool_result',
+          timestamp: Date.now(),
+          sessionId,
+          source: 'complete' as EventSource,
+          messageId,
+          toolCallId: block.tool_use_id,
+          output: block.content,
+          isError: block.is_error ?? false,
+          parentToolUseId: parent_tool_use_id ?? undefined,
+        };
+        events.push(toolResultEvent);
       } else {
         const unhandled: never = block;
         helpers.logger.warn(
diff --git a/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts b/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts
index 18e26f300..5ecb9cefd 100644
--- a/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts
+++ b/libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts
@@ -195,6 +195,54 @@ describe('AssistantMessageTransformer', () => {
     });
   });

+  it('suppresses envelopes for an empty-string text block', () => {
+    const msg = {
+      uuid: 'u-empty-text',
+      message: {
+        id: 'm-empty-text',
+        model: 'claude-opus',
+        content: [{ type: 'text', text: '' }],
+      },
+    } as never;
+
+    const events = transformer.transform(
+      msg,
+      state,
+      helpers,
+      'sess-empty-text' as never,
+    );
+
+    expect(events).toEqual([]);
+    expect(helpers.logger.debug).toHaveBeenCalledWith(
+      '[SdkMessageTransformer] Skipping assistant message without renderable events',
+      { messageId: 'm-empty-text' },
+    );
+  });
+
+  it('still emits text_delta with the correct blockIndex for a non-empty text block', () => {
+    const msg = {
+      uuid: 'u-nonempty-text',
+      message: {
+        id: 'm-nonempty-text',
+        model: 'claude-opus',
+        content: [
+          { type: 'thinking', thinking: '', signature: 'sig' },
+          { type: 'text', text: 'answer' },
+        ],
+      },
+    } as never;
+
+    const events = transformer.transform(
+      msg,
+      state,
+      helpers,
+      'sess-nonempty-text' as never,
+    );
+
+    const textDelta = events.find((e) => e.eventType === 'text_delta');
+    expect(textDelta).toMatchObject({ delta: 'answer', blockIndex: 1 });
+  });
+
   it('emits envelopes for renderable thinking and text', () => {
     const msg = {
       uuid: 'u-thinking-text',
@@ -573,6 +621,44 @@ describe('AssistantMessageTransformer', () => {
     );
   });

+  it('emits background_agent_started BEFORE the tool_result for the same toolCallId', () => {
+    state.hasBackgroundTaskToolUseId.mockReturnValue(true);
+    const msg = {
+      uuid: 'u-order',
+      message: {
+        id: 'm-order',
+        model: 'claude-opus',
+        content: [
+          {
+            type: 'tool_result',
+            tool_use_id: 'tool-bg-order',
+            content: 'started\noutput_file: /tmp/bg.log\n',
+            is_error: false,
+          },
+        ],
+      },
+    } as never;
+
+    const events = transformer.transform(
+      msg,
+      state,
+      helpers,
+      'sess-order' as never,
+    );
+
+    const bgIndex = events.findIndex(
+      (e) => e.eventType === 'background_agent_started',
+    );
+    const resultIndex = events.findIndex(
+      (e) =>
+        e.eventType === 'tool_result' &&
+        (e as { toolCallId?: string }).toolCallId === 'tool-bg-order',
+    );
+    expect(bgIndex).toBeGreaterThanOrEqual(0);
+    expect(resultIndex).toBeGreaterThanOrEqual(0);
+    expect(bgIndex).toBeLessThan(resultIndex);
+  });
+
   // The tool_result that triggers background_agent_started carries neither the
   // agent type nor the SDK agent id. Both used to be dropped: agentType was the
   // literal 'unknown' and agentId was omitted, so the tray chip read "unknown"
```

## Test command and real output

Project name resolved from `libs/backend/agent-sdk/project.json`:
`@ptah-extension/agent-sdk`.

```
npx nx run-many -t test -p @ptah-extension/agent-sdk
```

Output (tail):

```
 NX  Running target test for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk

> nx run @ptah-extension/agent-sdk:test

(node:22612) Warning: Failed to load the ES module: D:\projects\ptah-extension\libs\backend\agent-sdk\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 1 skipped, 85 passed, 85 of 86 total
Tests:       2 skipped, 1405 passed, 1407 total
Snapshots:   0 total
Time:        20.806 s, estimated 61 s
Ran all test suites.

 NX  Successfully ran target test for project @ptah-extension/agent-sdk
```

The `jest.config.ts` ES-module warning is a pre-existing, unrelated Nx/Jest
loader warning — it printed before this batch's edits too and is not caused
by this change. 1 project ran (confirmed by the "Running target test for
project @ptah-extension/agent-sdk" header, singular). All 1405 executed
tests passed, including the 3 new specs added for F2/F3 and every
pre-existing spec in this file and the rest of the project.
