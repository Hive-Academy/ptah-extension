# Batch R1 — report

**Task:** TASK_2026_376
**Batch:** R1 (review-finding closure)
**Findings closed:** logic 1, 2, 3, 4 (consumer half); style 2, 4
**Write boundary honored:** `libs/backend/agent-sdk/src/lib/curator-llm-adapter/**`,
`libs/backend/memory-contracts/**`, `libs/backend/memory-curator/**`. No other
file was changed. No git write command was run.

---

## Files changed

| File                                                                                        | Findings                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------- |
| `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`      | logic 1, logic 2, style 2, style 4 |
| `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts` | logic 1, logic 2                   |
| `libs/backend/memory-contracts/src/lib/curator-llm.port.ts`                                 | logic 2                            |
| `libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts`                  | logic 2                            |
| `libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts`             | logic 2                            |
| `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts`                      | logic 3                            |
| `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts`                 | logic 3                            |
| `libs/backend/memory-curator/src/lib/memory-curator.service.ts`                             | logic 2, 3, 4                      |
| `libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts`                        | logic 2, 3, 4                      |

---

## Logic finding 1 — HIGH. The parser now reads the LAST assistant message

**What changed.** `runQuery` no longer accumulates `collected += block.text`
across every assistant message. It builds the text of each assistant message
into a local `messageText` and ASSIGNS it to `lastAssistantText`. That string is
what `parseDrafts` and `parseResolved` receive.

**Why this shape.** Both prompts state that the model's FINAL message must
contain only the JSON object, and `extractJsonObject` scans from index 0 and
returns the first balanced `{...}`. While `maxTurns` was 1 the two rules could
not disagree, because one turn is one assistant message. At six turns a
concatenation puts the model's working notes in front of its answer, and the
parser reads the notes. Assignment makes the parser read the message the prompt
promised. `collected` is gone rather than kept for logging: the only diagnostic
it carried was a character total, and the tool counters already report what a
multi-turn run did.

**One decision worth stating.** I take the last assistant message, not the last
assistant message that CONTAINED text. If a run answers correctly and then emits
a trailing tool-only message, `lastAssistantText` is `''` and the pass reports
`no-output`, which defers. The alternative — remember the last text-bearing
message — would parse that answer, but it would also re-open the decoy case
whenever the final message is tool-only and an earlier message held a decoy.
Deferring costs one re-curation on the next drain. Parsing the wrong object
costs the session's memories permanently. The cheaper failure was chosen, and a
spec pins it ("reports NO-OUTPUT when a run that answered earlier ends on tool
calls").

**Specs added** (`sdk-internal-query.curator-llm.spec.ts`, new describe block
"a multi-turn run is read from its LAST message"):

- a two-message run whose first message holds the decoy `{"memories": []}` plus
  a `tool_use`, and whose last message holds the real draft — asserts the real
  draft is extracted. This is failure scenario A from the review;
- a two-message run whose first message holds the unparseable
  `{subject: X}` — asserts the valid answer still parses. Failure scenario B;
- the trailing-tool-call case described above;
- the same last-message rule on the `resolve` path, asserting `mergeTargetId`
  comes from the last message and not from the decoy.

A new `streamOfMessages` test helper was added, because `streamOfBlocks` yields
exactly one assistant message and cannot express a multi-turn run at all.

---

## Logic finding 2 — MEDIUM. `CuratorExtraction` gained a `no-output` arm

**Contract** (`memory-contracts/src/lib/curator-llm.port.ts`):

```ts
| {
    readonly status: 'no-output';
    readonly usedTools: boolean;
    readonly toolNames: readonly string[];
  }
```

`usedTools` distinguishes the tool-only run from the silent one without forcing
two arms on the caller, which treats them identically. `toolNames` is carried
because it is the only thing that says WHAT the pass spent its turns on.

**Producer** (`sdk-internal-query.curator-llm.ts`). The `tools-only` and
`silent` arms of `CuratorQueryOutcome` now return `no-output` instead of
`{ status: 'extracted', drafts: [] }`. The two log lines stay distinct — one is
a model that worked and did not answer, the other is a model that did nothing.
The `resolve` path is deliberately unchanged: its tool-only and silent arms
already degrade to "store the drafts unmerged", which loses no input and needs
no discriminator.

**Loop** (`curator-window-runner.ts`). A `no-output` window ABANDONS the pass and
returns the arm, exactly as a throw does. Continuing would union the other
windows' drafts into a result the caller reads as complete, and the caller
consumes the whole session's observations on a complete result — a partial
extraction wearing a full one. This follows the rule the runner already
documents for a throw.

**Caller** (`memory-curator.service.ts`). New `recordCuratorNoOutput` maps the
arm to `outcome: 'stalled'` with zero counts, the same shape
`recordCuratorStall` and `recordCuratorDeferral` return. It touches neither
`lastRunAtMs` nor `lastRunStatsCache`, pushes no `curator-run`, and persists
nothing. `MemoryTriggerService.invokeCurate` already reattaches the episode and
skips `markProcessed` on `'stalled'`, so no trigger-side change was needed —
and none was permitted by the write boundary.

The event kind is the existing `rate-limited` with
`stats: { source: 'curator-llm', reason: 'no-output', usedTools, toolNames }`.
A new `MemoryCuratorEventKind` member would be a frontend-visible change for a
distinction the frontend does not draw, and the frontend is outside this batch.

**Residual risk, stated rather than hidden.** A model that answers this way on
every pass for one session will re-curate that session on every drain and never
consume its observations. That is the trade the finding asks for, and it is the
right way round: repeated prompts are recoverable, discarded observations are
not. If it is ever observed in practice, the fix is a per-session no-output
counter in the trigger service — outside this batch's boundary.

**Specs added:** adapter-level (`no-output` with `usedTools` true and false, and
the pre-existing empty-output test updated to the new arm); runner-level (a
`no-output` window stops the loop after two of three windows and does not union
the first window's drafts); service-level (`outcome: 'stalled'`, `lastRunInfo()`
untouched, a `rate-limited` event present and no `curator-run` event).

**Two existing specs were updated, not deleted.** "still resolves EXTRACTED (not
stalled) after a tool-only pass" and "returns an EXTRACTED status with no drafts
… when model output is empty" asserted the exact behaviour this finding calls a
defect. Both now assert `no-output`, with the reason recorded in the test body.

---

## Logic finding 3 — MEDIUM. The job queue has a wait ceiling, and `doCurate` checks the abort

**Ceiling** (`curator-job-queue.ts`). `CuratorJobQueue` takes a
`waitCeilingMs`, defaulting to the new exported
`CURATOR_QUEUE_WAIT_CEILING_MS = 180_000`. A waiter whose turn has not arrived
by then is rejected with the new `CuratorQueueWaitTimeoutError`, and its job is
never invoked when its turn eventually comes.

The F4 fix is not weakened. The chain still always waits for its predecessor —
the caller's promise and the chain are now two different promises, precisely so
that answering a caller early cannot let two passes run at once. The chain also
still never rejects: a failing job is reported to its own caller through the
deferred, and a synchronous throw from `job()` is caught for the same reason,
so one bad pass cannot break the queue for every pass behind it.

Why three minutes: a 372-event session measured 24-37 s per window
(TASK_2026_374), so the ordinary one-or-two-window pass clears well inside it
and a normal waiter is never rejected. A waiter behind the eight-window worst
case, or behind two passes, does time out — which is the intended answer, since
a timed-out waiter defers and its input survives.

**Mapping** (`memory-curator.service.ts`). `curate()` catches
`CuratorQueueWaitTimeoutError` and returns `recordCuratorDeferral(...)` with
`reason: 'curator-queue-wait-timeout'`. Any other rejection is re-thrown
unchanged. `recordCuratorDeferral` now takes a `reason` and reports a matching
`source` through the new `DEFERRAL_SOURCES` map, so the three deferral causes
are distinguishable in the Activity log without reading the message text.

**Abort.** `doCurate` returns `recordCuratorDeferral(..., 'caller-aborted')`
when `input.signal?.aborted` is already true on entry, before any window is
planned and before the LLM is dialled. `CuratorWindowRunner` still checks the
signal between windows; this is the one check that happens before any work.

**Specs added:**

- queue level, with fake timers and a 1000 ms ceiling: a waiter that exceeds the
  ceiling rejects with `CuratorQueueWaitTimeoutError`, the running pass is
  untouched and still resolves, and the abandoned job is never invoked even
  after its turn arrives;
- a later pass submitted after the congestion cleared runs normally (the ceiling
  is per waiter and is not inherited);
- a waiter that gets its turn inside the ceiling is never rejected, and the
  cancelled timer does not fire afterwards;
- service level, with fake timers: a second `curate()` queued behind a blocked
  pass resolves `outcome: 'stalled'` after `CURATOR_QUEUE_WAIT_CEILING_MS`,
  `llm.extract` has been called exactly once at that point, the blocking pass
  still completes with `outcome: 'ran'`, and `llm.extract` is still at one call
  afterwards;
- service level: a `curate()` whose signal is already aborted returns
  `'stalled'` and never calls `llm.extract`.

**Note on two pre-existing queue specs.** Moving the caller onto its own
promise shifted microtask ordering by one tick, so
"runs one job at a time, in submission order" and "reports the passes it is
holding" would have needed extra `await Promise.resolve()` lines. I did not
change them. Instead `pending` now decrements when the CALLER settles, which
matches the property its docblock already claimed ("passes submitted and not yet
settled"), and the caller promise adopts the job's promise rather than being
resolved from an `async` continuation. Both original specs pass unmodified.

---

## Logic finding 4 — MEDIUM, consumer half. The registry callback rejects a synthetic id

`MemoryCuratorService.start()` returns immediately, with a debug line, when the
PreCompact fan-out carries a `sessionId` beginning `internal-query-`. The prefix
lives in the new `INTERNAL_QUERY_SESSION_PREFIX` constant with the reasoning
attached.

`sdk-query-runner.service.ts` was not touched — it belongs to another agent, and
the producer-side guard is theirs.

**Specs added:** the fan-out callback is captured from a fake registry; an
`internal-query-1757000000000` id produces no transcript read and no event at
all, while a real UUID session id through the same callback does reach
`transcriptReader.read`. The second spec is there so the guard cannot be widened
into "ignore everything" without a test failing.

---

## Style finding 2 — MEDIUM. The SDK's own guards, no invented shapes

The collector now uses `isAssistantMessage`, `isTextBlock`, `isToolUseBlock`,
`isResultMessage` and `isErrorResult` from
`agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`. Every
`as unknown as { … }` in `runQuery` is gone, including the one that read
`subtype` off the result message: `hitTurnCeiling` is now
`isErrorResult(msg) && msg.subtype === 'error_max_turns'`, which the compiler
checks against the installed SDK's `SDKResultError` union. No new abstraction
was introduced. This matches what `assistant-message.transformer.ts` already
does with the same guards.

## Style finding 4 — LOW. The batch-history comment is gone

The comment at the `tools-only` arm no longer mentions what "this batch owns" or
points at `b5-report.md`. It states the durable reason instead: an empty
extraction is what the caller reads as a successful pass and consumes its input
on, so a run that never wrote its answer must not report one. The two arms stay
separate because their log lines diagnose different failures.

---

## Verification

Read from `project.json` in each library: `@ptah-extension/agent-sdk`,
`@ptah-extension/memory-curator`, `@ptah-extension/memory-contracts`.

**`@ptah-extension/memory-contracts` has no `test` target** — its
`project.json` declares only `build` and `typecheck`. The prescribed three-name
command therefore reports `Running target test for 2 projects`, and Nx prints an
explicit line naming the project it dropped. That is the honest N for this set,
not a silently misspelled name. The command and its full output:

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache

 NX   The following projects do not have a configuration for any of the provided targets ("test")

- @ptah-extension/memory-contracts


 NX   Running target test for 2 projects:

- @ptah-extension/agent-sdk
- @ptah-extension/memory-curator



> nx run @ptah-extension/memory-curator:test


Test Suites: 2 skipped, 30 passed, 30 of 32 total
Tests:       60 skipped, 478 passed, 538 total
Snapshots:   0 total
Time:        23.565 s, estimated 34 s
Ran all test suites.

> nx run @ptah-extension/agent-sdk:test

(node:10804) Warning: Failed to load the ES module: D:\projects\ptah-extension\libs\backend\agent-sdk\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 1 skipped, 86 passed, 86 of 87 total
Tests:       2 skipped, 1439 passed, 1441 total
Snapshots:   0 total
Time:        24.866 s, estimated 31 s
Ran all test suites.



 NX   Successfully ran target test for 2 projects
```

Zero failures. The skipped suites and tests are pre-existing `describe.skip`
blocks, not anything this batch disabled.

Because `memory-contracts` carries the contract change and has no test target,
its correctness is covered by `typecheck`, run together with the two direct
consumers of the changed union:

```
$ npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/memory-curator \
    @ptah-extension/memory-contracts @ptah-extension/rpc-handlers @ptah-extension/cli-engine --skip-nx-cache

 NX   Successfully ran target typecheck for 5 projects
```

Lint on the two libraries with a `lint` target:

```
$ npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/agent-sdk --skip-nx-cache

✖ 38 problems (0 errors, 38 warnings)

 NX   Successfully ran target lint for 2 projects
```

All 38 warnings are pre-existing `max-lines` and `no-non-null-assertion`
warnings in files this batch did not touch. Filtering the lint output for the
nine changed files returns nothing.

## Constraints checked

- `CURATOR_MAX_TURNS` is unchanged at 6. `lane: 'memory-curator'` is unchanged.
- The F4 job-queue fix is intact: passes still run strictly one at a time, the
  chain still cannot be broken by a failing job, and coalescing is still checked
  before the enqueue. Three of its specs are unmodified and pass.
- `memory-curator` gained no import of `agent-sdk`. The queue-slot timeout is
  still recognised by error name through the bounded `cause` walk in
  `queue-slot-timeout.ts`, which is untouched. The new
  `CuratorQueueWaitTimeoutError` is `memory-curator`'s own class, matched with
  `instanceof`, because it is raised inside the same library.
- Every new `catch` uses `catch (error: unknown)`. No `@ts-ignore`, no
  `@ts-expect-error`, no backwards-compatibility shim, no re-export of a removed
  symbol.

## Disagreements

None. All six findings were implemented as filed. The two places where I chose
between defensible options — reading the last assistant message rather than the
last text-bearing one, and abandoning a pass on a `no-output` window rather than
unioning the remaining windows — are recorded above with the reasoning, and both
choose the recoverable failure over the permanent one.

---

## Exact diff

```diff
diff --git a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
index c4fc4d191..e72d29156 100644
--- a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
+++ b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
@@ -116,6 +116,28 @@ function streamOfBlocks(
   };
 }

+/**
+ * A MULTI-TURN stream: one assistant message per entry, in order.
+ *
+ * `streamOfBlocks` cannot express this — it yields exactly one assistant
+ * message, which is all `maxTurns: 1` could ever produce. At six turns the run
+ * that matters is the one whose early messages are working notes and whose LAST
+ * message is the answer (TASK_2026_376 R1).
+ */
+function streamOfMessages(
+  messages: readonly (readonly AssistantBlock[])[],
+  resultSubtype?: string,
+): () => AsyncIterable<unknown> {
+  return async function* () {
+    for (const blocks of messages) {
+      yield { type: 'assistant', message: { content: blocks } };
+    }
+    yield resultSubtype
+      ? { type: 'result', subtype: resultSubtype }
+      : { type: 'result' };
+  };
+}
+
 interface ExecuteCapture {
   model?: string;
   cwd?: string;
@@ -127,6 +149,7 @@ interface ExecuteCapture {
 function makeInternalQuery(opts: {
   text?: string;
   blocks?: readonly AssistantBlock[];
+  messages?: readonly (readonly AssistantBlock[])[];
   resultSubtype?: string;
   throwOnExecute?: Error;
   capture?: ExecuteCapture;
@@ -147,6 +170,11 @@ function makeInternalQuery(opts: {
           opts.capture.authWasPresent = 'auth' in config;
         }
         if (opts.throwOnExecute) throw opts.throwOnExecute;
+        if (opts.messages) {
+          return {
+            stream: streamOfMessages(opts.messages, opts.resultSubtype)(),
+          };
+        }
         if (opts.blocks) {
           return {
             stream: streamOfBlocks(opts.blocks, opts.resultSubtype)(),
@@ -646,9 +674,11 @@ describe('SdkInternalQueryCuratorLlm — error vs empty', () => {
     );
   });

-  it('returns an EXTRACTED status with no drafts (does not throw) when model output is empty', async () => {
-    // `status: 'extracted'` even though the list is empty: the query ran and
-    // the model said nothing. Only the quota gate produces `'stalled'`.
+  it('returns NO-OUTPUT (does not throw) when model output is empty', async () => {
+    // A run that produced no text and called no tool is not an empty
+    // extraction: nothing came back to extract FROM. `'extracted'` here told
+    // the caller to consume the session's observations for a pass that never
+    // reported on them (TASK_2026_376 R1).
     const internalQuery = makeInternalQuery({ text: '' });
     const adapter = new SdkInternalQueryCuratorLlm(
       makeLogger(),
@@ -656,8 +686,9 @@ describe('SdkInternalQueryCuratorLlm — error vs empty', () => {
       makeWorkspace(''),
     );
     await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
-      status: 'extracted',
-      drafts: [],
+      status: 'no-output',
+      usedTools: false,
+      toolNames: [],
     });
   });

@@ -768,17 +799,33 @@ describe('SdkInternalQueryCuratorLlm — tool-only runs are not silent runs', ()
     });
   });

-  it('still resolves EXTRACTED (not stalled) after a tool-only pass', async () => {
-    // A tool-only pass DID the work. Stalling would tell the trigger service to
-    // keep the episodes, which is the opposite of what happened.
+  it('resolves NO-OUTPUT, never an empty extraction, after a tool-only pass', async () => {
+    // `{ status: 'extracted', drafts: [] }` is what the caller reads as "this
+    // pass ran and found nothing", and it consumes the session's queued
+    // observations on that reading. A run that spent its turns in tool calls and
+    // never wrote its answer has not earned that (TASK_2026_376 R1).
     const adapter = new SdkInternalQueryCuratorLlm(
       makeLogger(),
       makeInternalQuery({ blocks: toolsOnly }),
       makeWorkspace(''),
     );
     await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
-      status: 'extracted',
-      drafts: [],
+      status: 'no-output',
+      usedTools: true,
+      toolNames: ['mcp__ptah__ptah_memory_search'],
+    });
+  });
+
+  it('resolves NO-OUTPUT with usedTools false when the run said nothing at all', async () => {
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({ blocks: [] }),
+      makeWorkspace(''),
+    );
+    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
+      status: 'no-output',
+      usedTools: false,
+      toolNames: [],
     });
   });

@@ -842,3 +889,127 @@ describe('SdkInternalQueryCuratorLlm — tool-only runs are not silent runs', ()
     ).resolves.toEqual([{ ...drafts[0], mergeTargetId: null }]);
   });
 });
+
+describe('SdkInternalQueryCuratorLlm — a multi-turn run is read from its LAST message', () => {
+  // Both prompts tell the model that its FINAL message must contain only the
+  // JSON object. `extractJsonObject` reads from index 0 and takes the FIRST
+  // balanced `{...}`, so while the collector concatenated every assistant
+  // message the parser read the model's working notes instead of its answer
+  // (TASK_2026_376 R1, logic finding 1).
+  const REAL_ANSWER =
+    '{"memories":[{"kind":"fact","subject":"build","content":"nx run-many is the multi-project runner","salienceHint":0.7}]}';
+
+  it('ignores a DECOY json object in an earlier message and parses the last one', async () => {
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({
+        messages: [
+          [
+            {
+              type: 'text',
+              text: 'Let me check what is already stored. Draft so far: {"memories": []}',
+            },
+            { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
+          ],
+          [{ type: 'text', text: REAL_ANSWER }],
+        ],
+      }),
+      makeWorkspace(''),
+    );
+
+    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
+    expect(result.status).toBe('extracted');
+    expect(result.status === 'extracted' && result.drafts).toMatchObject([
+      {
+        kind: 'fact',
+        subject: 'build',
+        content: 'nx run-many is the multi-project runner',
+        salienceHint: 0.7,
+      },
+    ]);
+  });
+
+  it('does not let an unparseable earlier message destroy a valid answer', async () => {
+    // Scenario B from the review: `I will search memory for {subject: X}` slices
+    // to `{subject: X}`, `JSON.parse` throws, and the whole pass returned zero
+    // drafts while reporting success.
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({
+        messages: [
+          [
+            {
+              type: 'text',
+              text: 'I will search memory for {subject: X} first.',
+            },
+          ],
+          [{ type: 'text', text: REAL_ANSWER }],
+        ],
+      }),
+      makeWorkspace(''),
+    );
+
+    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
+    expect(result.status === 'extracted' && result.drafts).toHaveLength(1);
+  });
+
+  it('reports NO-OUTPUT when a run that answered earlier ends on tool calls', async () => {
+    // The last message carries no text, so there is no answer to read. Deferring
+    // costs a re-curation next drain; consuming the input would cost the
+    // session's memories permanently.
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({
+        messages: [
+          [{ type: 'text', text: REAL_ANSWER }],
+          [{ type: 'tool_use', name: 'Read' }],
+        ],
+        resultSubtype: 'error_max_turns',
+      }),
+      makeWorkspace(''),
+    );
+
+    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
+      status: 'no-output',
+      usedTools: true,
+      toolNames: ['Read'],
+    });
+  });
+
+  it('reads the LAST message on the resolve path too', async () => {
+    const drafts = [
+      {
+        kind: 'fact' as const,
+        subject: 'ptah',
+        content: 'lanes exist',
+        salienceHint: 0.5,
+      },
+    ];
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({
+        messages: [
+          [
+            {
+              type: 'text',
+              text: 'Looking at the related notes: {"memories": []}',
+            },
+          ],
+          [
+            {
+              type: 'text',
+              text: '{"memories":[{"kind":"fact","subject":"ptah","content":"lanes exist","salienceHint":0.5,"mergeTargetId":"m1"}]}',
+            },
+          ],
+        ],
+      }),
+      makeWorkspace(''),
+    );
+
+    await expect(
+      adapter.resolve(drafts, [
+        { id: 'm1', subject: 'ptah', content: 'older note' },
+      ]),
+    ).resolves.toMatchObject([{ ...drafts[0], mergeTargetId: 'm1' }]);
+  });
+});
diff --git a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
index d1576eb5b..7fcec983a 100644
--- a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
+++ b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
@@ -17,7 +17,14 @@ import { SDK_TOKENS } from '../di/tokens';
 import type { InternalQueryService } from '../internal-query';
 import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
 import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
-import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
+import {
+  isAssistantMessage,
+  isErrorResult,
+  isResultMessage,
+  isTextBlock,
+  isToolUseBlock,
+  type SDKMessage,
+} from '../types/sdk-types/claude-sdk.types';
 import {
   EXTRACT_SYSTEM_PROMPT,
   buildExtractUserPrompt,
@@ -277,25 +284,33 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
         providerId: outcome.providerId,
       };
     }
-    // `tools-only` and `silent` both yield no drafts, and the CONTRACT cannot
-    // tell them apart: `CuratorExtraction` has two arms, and adding a third
-    // means editing `memory-contracts` and `memory-curator`, neither of which
-    // this batch owns (reported in b5-report.md). What is inside reach is the
-    // record — an operator reading the log can now see that the pass ran, used
-    // tools, and chose not to write JSON, which is a different event from a
-    // pass that produced nothing at all.
+    // `tools-only` and `silent` both produced no JSON, and neither is an empty
+    // extraction. `{ status: 'extracted', drafts: [] }` is what the caller reads
+    // as "this pass ran and honestly found nothing", and it consumes the
+    // session's queued observations on that reading. A run that spent six turns
+    // in tool calls and never wrote its answer has not earned that. The
+    // `no-output` arm is the difference, and the caller maps it to the same
+    // input-preserving outcome a stall gets (TASK_2026_376 R1).
+    //
+    // The two arms stay distinct HERE — the log line for each is different —
+    // because they diagnose different things: one is a model that worked and
+    // did not answer, the other is a model that did nothing at all.
     if (outcome.kind === 'tools-only') {
       this.logger.info(
-        '[memory-curator] curator extract pass did its work through tools and returned no JSON; nothing to persist from this pass',
+        '[memory-curator] curator extract pass did its work through tools and returned no JSON; leaving this session for the next pass',
         { toolUses: outcome.toolUses, toolNames: outcome.toolNames },
       );
-      return { status: 'extracted', drafts: [] };
+      return {
+        status: 'no-output',
+        usedTools: true,
+        toolNames: outcome.toolNames,
+      };
     }
     if (outcome.kind === 'silent') {
       this.logger.warn(
         '[memory-curator] curator extract pass produced neither text nor tool calls',
       );
-      return { status: 'extracted', drafts: [] };
+      return { status: 'no-output', usedTools: false, toolNames: [] };
     }
     return { status: 'extracted', drafts: this.parseDrafts(outcome.text) };
   }
@@ -388,40 +403,52 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
         abortController,
         auth,
       });
-      let collected = '';
+      // The text of the LAST assistant message, not the concatenation of every
+      // one of them (TASK_2026_376 R1, logic finding 1).
+      //
+      // Both prompts tell the model that its FINAL message must contain only
+      // the JSON object, and `extractJsonObject` scans from index 0 and returns
+      // the FIRST balanced `{...}` it finds. While `maxTurns` was 1 those two
+      // rules could not disagree: one turn is one assistant message. At six
+      // turns a concatenation puts the model's THINKING-OUT-LOUD in front of
+      // its answer, so a first turn reading `draft so far: {"memories": []}`
+      // parses cleanly and returns zero drafts, and a first turn reading
+      // `I will search for {subject: X}` fails to parse at all. Either way
+      // `parseDrafts` answers `[]`, the pass reports a successful empty run,
+      // and `MemoryTriggerService` marks the observations processed — the
+      // session's real drafts are gone and it can never be curated again.
+      //
+      // Assigning rather than appending is the whole fix: the parser now reads
+      // the message the prompt promised. A final message that carries no text
+      // leaves this `''`, which is the `tools-only` / `silent` path below, and
+      // that path no longer consumes its input either.
+      let lastAssistantText = '';
       let toolUses = 0;
       const toolNames: string[] = [];
       let hitTurnCeiling = false;
       for await (const msg of handle.stream as AsyncIterable<SDKMessage>) {
-        if (msg.type === 'assistant') {
-          const message = (
-            msg as unknown as {
-              message?: {
-                content?: Array<{ type: string; text?: string; name?: string }>;
-              };
-            }
-          ).message;
-          for (const block of message?.content ?? []) {
-            if (block.type === 'text' && typeof block.text === 'string') {
-              collected += block.text;
-            }
+        if (isAssistantMessage(msg)) {
+          let messageText = '';
+          for (const block of msg.message.content) {
+            if (isTextBlock(block)) messageText += block.text;
             // The half the old collector dropped. A turn spent on a tool call
             // contributed NOTHING here, so a run that searched memory and read
             // three files was reported exactly like a run that said nothing.
-            if (block.type === 'tool_use') {
+            if (isToolUseBlock(block)) {
               toolUses++;
-              if (typeof block.name === 'string' && block.name.length > 0) {
-                if (!toolNames.includes(block.name)) toolNames.push(block.name);
+              if (block.name.length > 0 && !toolNames.includes(block.name)) {
+                toolNames.push(block.name);
               }
             }
           }
+          lastAssistantText = messageText;
         }
-        if (msg.type === 'result') {
+        if (isResultMessage(msg)) {
           // `error_max_turns` is a RESULT in this SDK, never a throw, so an
           // exhausted budget is silent unless it is read here. It is the one
           // signal that says CURATOR_MAX_TURNS is set too low for the work.
-          const subtype = (msg as unknown as { subtype?: string }).subtype;
-          hitTurnCeiling = subtype === 'error_max_turns';
+          hitTurnCeiling =
+            isErrorResult(msg) && msg.subtype === 'error_max_turns';
           break;
         }
       }
@@ -431,8 +458,8 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
           { maxTurns: CURATOR_MAX_TURNS, toolUses, toolNames },
         );
       }
-      if (collected.length > 0)
-        return { kind: 'text', text: collected, toolUses };
+      if (lastAssistantText.length > 0)
+        return { kind: 'text', text: lastAssistantText, toolUses };
       if (toolUses > 0) return { kind: 'tools-only', toolUses, toolNames };
       return { kind: 'silent' };
     } catch (error: unknown) {
diff --git a/libs/backend/memory-contracts/src/lib/curator-llm.port.ts b/libs/backend/memory-contracts/src/lib/curator-llm.port.ts
index ce601a575..e84eb2435 100644
--- a/libs/backend/memory-contracts/src/lib/curator-llm.port.ts
+++ b/libs/backend/memory-contracts/src/lib/curator-llm.port.ts
@@ -61,6 +61,26 @@ export type CuratorStallReason = 'provider-cooling-down';
  *
  * **A stalled pass still extracts nothing.** There is no `drafts` on that arm:
  * the fix carries a signal, it does not invent a result.
+ *
+ * ## The third arm, and why the same argument produced it twice
+ *
+ * `no-output` is the run that reached the model and came back without JSON —
+ * the model spent its turns on tool calls, or answered nothing at all. Before
+ * TASK_2026_376 R1 that run resolved `{ status: 'extracted', drafts: [] }`,
+ * which is byte-identical to a pass that read the transcript and honestly found
+ * nothing durable in it. The caller acts on that difference exactly as it does
+ * on `stalled`: `MemoryTriggerService.invokeCurate` marks the drained
+ * `observation_queue` rows processed for a run, so a tool-only pass consumed the
+ * observations it never extracted from, and that session could never be curated
+ * again.
+ *
+ * The curator's turn budget went from 1 to 6 in the same task (F8), which is
+ * what turned a theoretical arm into the ordinary shape of a tool-using run.
+ *
+ * It is a separate arm rather than a second `CuratorStallReason` because the two
+ * differ in what they cost: a stall spent no upstream request, while a
+ * `no-output` run spent its whole turn budget. The caller's decision — keep the
+ * input — is the same, and the diagnostics are not.
  */
 export type CuratorExtraction =
   | {
@@ -72,6 +92,13 @@ export type CuratorExtraction =
       readonly reason: CuratorStallReason;
       /** Resolved provider id, or `''` when the curator inherits the active one. */
       readonly providerId: string;
+    }
+  | {
+      readonly status: 'no-output';
+      /** `true` when the run spent turns on tool calls, `false` when it said nothing at all. */
+      readonly usedTools: boolean;
+      /** Distinct tool names the run called, in first-use order. Empty when `usedTools` is false. */
+      readonly toolNames: readonly string[];
     };

 export interface ICuratorLLM {
diff --git a/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts b/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts
index 545a03b03..4eb423bba 100644
--- a/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts
+++ b/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts
@@ -1,7 +1,11 @@
 /**
  * `CuratorJobQueue` — one curation pass at a time (TASK_2026_376 F4).
  */
-import { CuratorJobQueue } from './curator-job-queue';
+import {
+  CURATOR_QUEUE_WAIT_CEILING_MS,
+  CuratorJobQueue,
+  CuratorQueueWaitTimeoutError,
+} from './curator-job-queue';

 function deferred(): {
   promise: Promise<void>;
@@ -63,6 +67,93 @@ describe('CuratorJobQueue', () => {
     await expect(following).resolves.toBe('still ran');
   });

+  it('rejects a waiter that never gets its turn within the ceiling', async () => {
+    // TASK_2026_376 R1, logic finding 3. `memory:runNow` calls `curate()` with
+    // no signal, so an unbounded wait is a spinner the code cannot end.
+    jest.useFakeTimers();
+    try {
+      const queue = new CuratorJobQueue(1000);
+      const blocker = deferred();
+      const ran: string[] = [];
+
+      const first = queue.run(async () => {
+        ran.push('first');
+        await blocker.promise;
+        return 'first';
+      });
+      const second = queue.run(async () => {
+        ran.push('second');
+        return 'second';
+      });
+      const rejection = second.catch((error: unknown) => error);
+
+      await Promise.resolve();
+      jest.advanceTimersByTime(1001);
+      const error = await rejection;
+      expect(error).toBeInstanceOf(CuratorQueueWaitTimeoutError);
+
+      // The chain is NOT broken and the running pass is untouched.
+      blocker.resolve();
+      await expect(first).resolves.toBe('first');
+      // The abandoned job is never invoked, even once its turn comes.
+      await Promise.resolve();
+      await Promise.resolve();
+      expect(ran).toEqual(['first']);
+    } finally {
+      jest.useRealTimers();
+    }
+  });
+
+  it('lets a later pass run normally after an abandoned one', async () => {
+    // The ceiling is per waiter, so a pass submitted after the congestion
+    // cleared gets its own full allowance and must not inherit the loser's.
+    jest.useFakeTimers();
+    try {
+      const queue = new CuratorJobQueue(1000);
+      const blocker = deferred();
+
+      const first = queue.run(() => blocker.promise);
+      const abandoned = queue.run(() => Promise.resolve('never'));
+      const rejection = abandoned.catch(() => 'rejected');
+
+      await Promise.resolve();
+      jest.advanceTimersByTime(1001);
+      await expect(rejection).resolves.toBe('rejected');
+
+      blocker.resolve();
+      await first;
+      const third = queue.run(() => Promise.resolve('third'));
+      await expect(third).resolves.toBe('third');
+    } finally {
+      jest.useRealTimers();
+    }
+  });
+
+  it('never rejects a pass that gets its turn inside the ceiling', async () => {
+    jest.useFakeTimers();
+    try {
+      const queue = new CuratorJobQueue(1000);
+      const blocker = deferred();
+      const first = queue.run(() => blocker.promise);
+      const second = queue.run(() => Promise.resolve('second'));
+
+      jest.advanceTimersByTime(500);
+      blocker.resolve();
+      await first;
+      await expect(second).resolves.toBe('second');
+      // The cancelled ceiling must not fire after the job started.
+      jest.advanceTimersByTime(5000);
+      await expect(second).resolves.toBe('second');
+    } finally {
+      jest.useRealTimers();
+    }
+  });
+
+  it('ships a bounded default ceiling', () => {
+    expect(CURATOR_QUEUE_WAIT_CEILING_MS).toBeGreaterThan(0);
+    expect(Number.isFinite(CURATOR_QUEUE_WAIT_CEILING_MS)).toBe(true);
+  });
+
   it('reports the passes it is holding', async () => {
     const queue = new CuratorJobQueue();
     const gate = deferred();
diff --git a/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts b/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts
index 2927aa7e4..534f4c5a0 100644
--- a/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts
+++ b/libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts
@@ -24,10 +24,11 @@
  * (`SdkInternalQueryCuratorLlm.runQuery`) and a per-lane ceiling of one, so two
  * curation passes were ALREADY serialised — by the gate, one query at a time,
  * with a destructive 60 s ceiling on each wait. This queue moves that same
- * waiting one level up, where it is ordered, unbounded in time, and loses
- * nothing. Throughput is identical. What changes is that a pass now holds its
- * position across all of its queries instead of re-entering the lottery between
- * each pair.
+ * waiting one level up, where it is ordered and loses nothing. Throughput is
+ * identical. What changes is that a pass now holds its position across all of
+ * its queries instead of re-entering the lottery between each pair. The wait
+ * itself is bounded by {@link CURATOR_QUEUE_WAIT_CEILING_MS}, and a pass that
+ * exceeds it is DEFERRED rather than dropped.
  *
  * ## What this is not
  *
@@ -39,35 +40,122 @@
  * skill-synthesis, which is the coupling the lanes exist to remove.
  */

+/**
+ * How long a submitted pass may wait for its turn before it gives up —
+ * TASK_2026_376 R1, logic finding 3.
+ *
+ * The chain above has no depth limit, and `curate()` is called by the
+ * `memory:runNow` RPC with no `AbortSignal`, so a user-triggered pass could sit
+ * behind an arbitrary number of background passes with no ceiling and nothing
+ * to cancel it. The user sees a spinner that the code cannot end.
+ *
+ * Three minutes is chosen against the measured cost of ONE pass ahead. A
+ * 372-event session split into the full eight windows measured 24-37 s per
+ * window (TASK_2026_374), so the ordinary one-or-two-window pass clears in well
+ * under a minute and a waiter behind it is never rejected. A waiter behind the
+ * eight-window worst case, or behind two passes, does time out — and that is
+ * the intended answer, not a regression: a timed-out waiter reports the same
+ * `stalled` outcome the concurrency gate does, so its observations are left
+ * untouched and the next drain curates them.
+ */
+export const CURATOR_QUEUE_WAIT_CEILING_MS = 180_000;
+
+/**
+ * A pass gave up waiting for its turn in {@link CuratorJobQueue}.
+ *
+ * Its own class rather than a bare `Error` so `MemoryCuratorService.curate` can
+ * tell it from a job that ran and threw. The two mean opposite things about the
+ * caller's input: this one never dispatched.
+ */
+export class CuratorQueueWaitTimeoutError extends Error {
+  constructor(readonly waitedMs: number) {
+    super(
+      `A curation pass waited longer than ${waitedMs}ms for its turn in the curator job queue.`,
+    );
+    this.name = 'CuratorQueueWaitTimeoutError';
+  }
+}
+
 /**
  * Serialises curation passes in submission order.
  *
  * A rejected job must not break the chain — `MemoryTriggerService` drains
  * several sessions and one failure may never take the others down — so the tail
- * is always the settled-either-way continuation, while the caller receives the
- * real promise and sees the real rejection.
+ * settles either way, while the caller gets the real value or the real rejection
+ * on a promise of its own.
  */
 export class CuratorJobQueue {
   private tail: Promise<unknown> = Promise.resolve();
   private depth = 0;

-  /** Passes submitted and not yet settled, including the running one. */
+  constructor(
+    private readonly waitCeilingMs: number = CURATOR_QUEUE_WAIT_CEILING_MS,
+  ) {}
+
+  /**
+   * Passes submitted and not yet settled, including the running one.
+   *
+   * A pass that gave up on the wait ceiling is settled — its caller has its
+   * answer — even though the chain still holds its position until its turn
+   * comes and is skipped.
+   */
   get pending(): number {
     return this.depth;
   }

-  /** Run `job` once every pass submitted before it has settled. */
+  /**
+   * Run `job` once every pass submitted before it has settled, or reject with
+   * {@link CuratorQueueWaitTimeoutError} when its turn does not arrive within
+   * the wait ceiling.
+   *
+   * The ceiling rejects the CALLER without breaking the chain, and that split is
+   * the whole of the implementation. The chain still waits for its predecessor,
+   * so the next pass starts only after this one's position is free — answering
+   * a caller early must not let two passes run at once. What a timeout changes
+   * is that the job is never invoked when its turn finally comes: a pass nobody
+   * is waiting for any more is not worth a provider call.
+   */
   run<T>(job: () => Promise<T>): Promise<T> {
     this.depth++;
-    const started = this.tail.then(job);
-    this.tail = started.then(
-      () => undefined,
-      () => undefined,
-    );
-    const settle = (): void => {
+    let resolveCaller!: (value: T | PromiseLike<T>) => void;
+    let rejectCaller!: (error: unknown) => void;
+    const caller = new Promise<T>((resolve, reject) => {
+      resolveCaller = resolve;
+      rejectCaller = reject;
+    });
+    const release = (): void => {
       this.depth--;
     };
-    void started.then(settle, settle);
-    return started;
+    void caller.then(release, release);
+
+    let timedOut = false;
+    const timer = setTimeout(() => {
+      timedOut = true;
+      rejectCaller(new CuratorQueueWaitTimeoutError(this.waitCeilingMs));
+    }, this.waitCeilingMs);
+    // Never hold a host open on a queue that is only waiting.
+    (timer as { unref?: () => void }).unref?.();
+
+    // The chain always waits for its predecessor, whatever the caller was told.
+    // A queue that let the next pass start because THIS one's caller gave up
+    // would run two passes at once, which is the property the queue exists to
+    // hold. It also never rejects — a failing job is reported to its own caller
+    // — so one bad pass cannot take the queue down with it.
+    this.tail = this.tail.then(() => {
+      clearTimeout(timer);
+      if (timedOut) return undefined;
+      try {
+        const running = job();
+        resolveCaller(running);
+        return running.then(
+          () => undefined,
+          () => undefined,
+        );
+      } catch (error: unknown) {
+        rejectCaller(error);
+        return undefined;
+      }
+    });
+    return caller;
   }
 }
diff --git a/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts b/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts
index 361139e5b..5009e7aed 100644
--- a/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts
+++ b/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts
@@ -250,3 +250,61 @@ describe('CuratorWindowRunner.extractAcrossWindows — queue-slot timeouts', ()
     expect(extract).toHaveBeenCalledTimes(1);
   });
 });
+
+/**
+ * A window whose model returned no JSON abandons the pass — TASK_2026_376 R1.
+ */
+describe('CuratorWindowRunner.extractAcrossWindows — a window that produced no output', () => {
+  function windows(count: number): readonly CuratorWindow[] {
+    return Array.from({ length: count }, (_, i) => ({
+      text: `window ${i}`,
+      recordIndices: [i],
+      windowIndex: i,
+      windowCount: count,
+    }));
+  }
+
+  function makeRunner(extract: jest.Mock): CuratorWindowRunner {
+    const logger = {
+      info: jest.fn(),
+      warn: jest.fn(),
+      error: jest.fn(),
+      debug: jest.fn(),
+    };
+    return new CuratorWindowRunner(logger as unknown as Logger, {
+      extract,
+      resolve: jest.fn(),
+    } as unknown as ICuratorLLM);
+  }
+
+  it('carries the arm to the caller and stops spending windows', async () => {
+    const extract = jest
+      .fn()
+      .mockResolvedValueOnce({
+        status: 'extracted',
+        drafts: [
+          { kind: 'fact', subject: 'a', content: 'first', salienceHint: 0.5 },
+        ],
+      })
+      .mockResolvedValueOnce({
+        status: 'no-output',
+        usedTools: true,
+        toolNames: ['Read'],
+      })
+      .mockResolvedValue({ status: 'extracted', drafts: [] });
+    const runner = makeRunner(extract);
+
+    const result = await runner.extractAcrossWindows(windows(3));
+
+    // NOT `{ status: 'extracted', drafts: [first] }`. Window 2's content was
+    // never extracted, so a union of the others is a partial extraction wearing
+    // a complete one — and the caller consumes the whole session's observations
+    // on a complete one.
+    expect(result).toEqual({
+      status: 'no-output',
+      usedTools: true,
+      toolNames: ['Read'],
+    });
+    expect(extract).toHaveBeenCalledTimes(2);
+  });
+});
diff --git a/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts b/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts
index 2bb304bf7..4b7d17174 100644
--- a/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts
+++ b/libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts
@@ -26,12 +26,12 @@ import { isQueueSlotTimeout, QueueSlotRetryBudget } from './queue-slot-timeout';
 /**
  * The outcome of a whole window set.
  *
- * The two arms of {@link CuratorExtraction} are carried through unchanged, so
- * the service's existing handling of `extracted` and `stalled` is the same code
- * it always was. The three remaining arms are the failures a LOOP can have that
- * a single call cannot: a call that threw partway through, an abort noticed
- * between windows, and a window that never reached the model because the host
- * was congested.
+ * The arms of {@link CuratorExtraction} are carried through unchanged, so the
+ * service's existing handling of `extracted`, `stalled` and `no-output` is the
+ * same code it always was. The three remaining arms are the failures a LOOP can
+ * have that a single call cannot: a call that threw partway through, an abort
+ * noticed between windows, and a window that never reached the model because
+ * the host was congested.
  */
 export type WindowedExtraction =
   | CuratorExtraction
@@ -148,6 +148,14 @@ export class CuratorWindowRunner {
    *    it and the transcript is never curated again.
    *  - a `stalled` window stops the loop. A stall is a cooldown, so every
    *    remaining window would stall too.
+   *  - a `no-output` window ABANDONS the pass, for the same reason a throw
+   *    does (TASK_2026_376 R1). The arm means the model reached the end of its
+   *    turn budget without writing its answer, so that window's content was
+   *    never extracted. Continuing would union the OTHER windows' drafts into a
+   *    result the caller reads as complete, and the caller consumes the whole
+   *    session's observations on it — a partial extraction wearing a full one.
+   *    Returning the arm makes the caller keep the input and curate the whole
+   *    transcript again next drain.
    *  - `signal.aborted` is checked BETWEEN windows, not only inside the
    *    adapter, so an abort during a long chunked run stops promptly instead of
    *    after the current provider round trip times out.
@@ -201,6 +209,18 @@ export class CuratorWindowRunner {
         return { status: 'failed', error };
       }
       if (extraction.status === 'stalled') return extraction;
+      if (extraction.status === 'no-output') {
+        this.logger.info(
+          '[memory-curator] a curation window returned no JSON; abandoning the pass so its input survives',
+          {
+            completedWindows,
+            windows: windows.length,
+            usedTools: extraction.usedTools,
+            toolNames: extraction.toolNames.join(','),
+          },
+        );
+        return extraction;
+      }
       completedWindows++;
       for (const draft of extraction.drafts) {
         const key = `${draft.subject ?? ''}\u0000${draft.content}`;
diff --git a/libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts b/libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts
index 683853c13..79e8b14ce 100644
--- a/libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts
+++ b/libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts
@@ -14,6 +14,7 @@ import type { SalienceScorer } from './salience-scorer';
 import type { ICuratorLLM } from './curator-llm/curator-llm.interface';
 import { CURATOR_TRANSCRIPT_MAX_CHARS } from './curator-llm/clamp-transcript';
 import { CURATOR_MAX_WINDOWS } from './curator-llm/transcript-windows';
+import { CURATOR_QUEUE_WAIT_CEILING_MS } from './curator-llm/curator-job-queue';
 import type { MemoryCuratorEvent } from './diagnostics.types';

 interface RecordingTracer extends ITracer {
@@ -1617,3 +1618,205 @@ describe('MemoryCuratorService — concurrency-slot loss (TASK_2026_376 F4)', ()
     expect(stats.outcome).toBe('ran');
   });
 });
+
+/**
+ * TASK_2026_376 R1 — the three ways a pass must now decline to consume its
+ * input, and the fan-out id it must refuse outright.
+ */
+describe('MemoryCuratorService — a pass that never read its input reports STALLED', () => {
+  type CompactionCallback = Parameters<
+    ICompactionCallbackRegistry['register']
+  >[0];
+
+  function buildParts(llm: ICuratorLLM): {
+    svc: MemoryCuratorService;
+    logger: Logger;
+    transcriptReader: ITranscriptReader;
+    store: MemoryStore;
+    callbacks: CompactionCallback[];
+  } {
+    const callbacks: CompactionCallback[] = [];
+    const registry = {
+      register: jest.fn((cb: CompactionCallback) => {
+        callbacks.push(cb);
+        return () => {
+          /* noop */
+        };
+      }),
+    } as unknown as ICompactionCallbackRegistry;
+    const store = {
+      list: jest.fn(() => ({ memories: [], total: 0 })),
+      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
+      appendChunks: jest.fn().mockResolvedValue(undefined),
+      getById: jest.fn(),
+      updateSalience: jest.fn(),
+    } as unknown as MemoryStore;
+    const scorer = { score: jest.fn(() => 0.5) } as unknown as SalienceScorer;
+    const transcriptReader = {
+      read: jest.fn().mockResolvedValue('a real transcript'),
+    } as unknown as ITranscriptReader;
+    const logger = makeLogger();
+    const svc = new MemoryCuratorService(
+      logger,
+      registry,
+      store,
+      scorer,
+      transcriptReader,
+      llm,
+    );
+    return { svc, logger, transcriptReader, store, callbacks };
+  }
+
+  function llmReturning(extraction: unknown): ICuratorLLM {
+    return {
+      extract: jest.fn().mockResolvedValue(extraction),
+      resolve: jest.fn().mockResolvedValue([]),
+    } as unknown as ICuratorLLM;
+  }
+
+  it('maps a NO-OUTPUT extraction to stalled, so the observations survive', async () => {
+    // The pass reached the model, spent its turns on tool calls and never wrote
+    // its JSON. Reporting `'ran'` here is what told `MemoryTriggerService` to
+    // mark the drained observation rows processed for a curation that produced
+    // nothing — the same data loss F4 had just closed, on a different path.
+    const { svc } = buildParts(
+      llmReturning({
+        status: 'no-output',
+        usedTools: true,
+        toolNames: ['mcp__ptah__ptah_memory_search'],
+      }),
+    );
+
+    const stats = await svc.curate({
+      sessionId: 'tool-only-session',
+      transcript: 'a real transcript worth curating',
+    });
+
+    expect(stats.outcome).toBe('stalled');
+    expect(stats.extracted).toBe(0);
+    // A stalled pass is not a run: it must not overwrite the last real one.
+    expect(svc.lastRunInfo().at).toBeNull();
+    const kinds = svc.recentEvents(20).map((e) => e.kind);
+    expect(kinds).toContain('rate-limited');
+    expect(kinds).not.toContain('curator-run');
+  });
+
+  it('records WHY it deferred, so a quiet curator can be diagnosed', async () => {
+    const { svc } = buildParts(
+      llmReturning({ status: 'no-output', usedTools: false, toolNames: [] }),
+    );
+    await svc.curate({ sessionId: 's1', transcript: 'a real transcript' });
+    const event = svc
+      .recentEvents(20)
+      .find((e) => e.kind === 'rate-limited');
+    expect(event?.stats).toMatchObject({
+      source: 'curator-llm',
+      reason: 'no-output',
+      usedTools: false,
+    });
+  });
+
+  it('does not run the pipeline at all for a caller that already aborted', async () => {
+    const llm = llmReturning({ status: 'extracted', drafts: [] });
+    const { svc } = buildParts(llm);
+    const controller = new AbortController();
+    controller.abort();
+
+    const stats = await svc.curate({
+      sessionId: 'withdrawn',
+      transcript: 'a real transcript',
+      signal: controller.signal,
+    });
+
+    expect(stats.outcome).toBe('stalled');
+    expect(llm.extract).not.toHaveBeenCalled();
+  });
+
+  it('refuses a PreCompact fan-out for an internal one-shot query id', async () => {
+    // `internal-query-<epoch>` names no session and has no transcript on disk.
+    // With `maxTurns: 6` the curator's OWN query can now cross a compaction
+    // boundary, so this id can be fanned back into the service that produced it
+    // (TASK_2026_376 R1, logic finding 4).
+    const { svc, transcriptReader, callbacks } = buildParts(
+      llmReturning({ status: 'extracted', drafts: [] }),
+    );
+    svc.start();
+    expect(callbacks).toHaveLength(1);
+
+    callbacks[0]({
+      sessionId: 'internal-query-1757000000000',
+      trigger: 'auto',
+      timestamp: Date.now(),
+      preTokens: 100_000,
+      cwd: 'D:/ws',
+    });
+    await Promise.resolve();
+
+    expect(transcriptReader.read).not.toHaveBeenCalled();
+    expect(svc.recentEvents(20)).toHaveLength(0);
+  });
+
+  it('still curates a real session id through the same fan-out', async () => {
+    const { svc, transcriptReader, callbacks } = buildParts(
+      llmReturning({ status: 'extracted', drafts: [] }),
+    );
+    svc.start();
+
+    callbacks[0]({
+      sessionId: '50653b50-a03b-45a5-937b-b4944ab2e9f1',
+      trigger: 'auto',
+      timestamp: Date.now(),
+      preTokens: 100_000,
+      cwd: 'D:/ws',
+    });
+    await new Promise((resolve) => setTimeout(resolve, 0));
+
+    expect(transcriptReader.read).toHaveBeenCalled();
+  });
+
+  it('defers a pass that waits past the job-queue ceiling instead of hanging', async () => {
+    // The `memory:runNow` RPC calls `curate()` with no signal, so before the
+    // ceiling a user-triggered pass could sit behind background passes with no
+    // bound and nothing to cancel it (TASK_2026_376 R1, logic finding 3).
+    jest.useFakeTimers();
+    try {
+      let releaseFirst!: () => void;
+      const firstPass = new Promise<void>((resolve) => {
+        releaseFirst = resolve;
+      });
+      const llm = {
+        extract: jest.fn(async () => {
+          await firstPass;
+          return { status: 'extracted', drafts: [] };
+        }),
+        resolve: jest.fn().mockResolvedValue([]),
+      } as unknown as ICuratorLLM;
+      const { svc } = buildParts(llm);
+
+      const blocking = svc.curate({
+        sessionId: 'background-pass',
+        transcript: 'a real transcript',
+      });
+      const queued = svc.curate({
+        sessionId: 'user-triggered-pass',
+        transcript: 'a real transcript',
+      });
+
+      await Promise.resolve();
+      jest.advanceTimersByTime(CURATOR_QUEUE_WAIT_CEILING_MS + 1);
+
+      const queuedStats = await queued;
+      expect(queuedStats.outcome).toBe('stalled');
+      // The chain is intact: the blocking pass still owns its slot and still
+      // finishes normally.
+      expect(llm.extract).toHaveBeenCalledTimes(1);
+      releaseFirst();
+      await expect(blocking).resolves.toMatchObject({ outcome: 'ran' });
+      // The abandoned pass is never dispatched, even once its turn arrives.
+      await Promise.resolve();
+      expect(llm.extract).toHaveBeenCalledTimes(1);
+    } finally {
+      jest.useRealTimers();
+    }
+  });
+});
diff --git a/libs/backend/memory-curator/src/lib/memory-curator.service.ts b/libs/backend/memory-curator/src/lib/memory-curator.service.ts
index ef6028646..7fa551773 100644
--- a/libs/backend/memory-curator/src/lib/memory-curator.service.ts
+++ b/libs/backend/memory-curator/src/lib/memory-curator.service.ts
@@ -34,7 +34,10 @@ import type {
   ResolvedMemoryDraft,
 } from './curator-llm/curator-llm.interface';
 import { CuratorWindowRunner } from './curator-llm/curator-window-runner';
-import { CuratorJobQueue } from './curator-llm/curator-job-queue';
+import {
+  CuratorJobQueue,
+  CuratorQueueWaitTimeoutError,
+} from './curator-llm/curator-job-queue';
 import {
   isQueueSlotTimeout,
   QueueSlotRetryBudget,
@@ -72,6 +75,40 @@ const TRANSCRIPT_PLACEHOLDER =
  */
 const MANUAL_COMPACTION_MAX_WINDOWS = 1;

+/**
+ * The synthetic session id `SdkQueryRunner` gives an internal one-shot query.
+ *
+ * A one-shot query has no Ptah session, so the runner mints
+ * `internal-query-${Date.now()}` and passes it down so the subagents that query
+ * spawns are registered against something (TASK_2026_295). The id names no
+ * session, and there is no transcript on disk under it.
+ *
+ * It reaches this service through the PreCompact fan-out. That was unreachable
+ * while `maxTurns` was 1 — a single round trip cannot cross a 100 000-token
+ * compaction threshold — and TASK_2026_376 F8 raised the curator's own budget
+ * to 6, which puts the curator's query on exactly that path. A PreCompact
+ * inside a curator run would hand this service the synthetic id, the transcript
+ * read would fail on it, and the fallback would `curate()` a placeholder: a
+ * curation job queued behind the real pass, a false curation event in the log,
+ * and the curator triggering itself. The producer side is guarded too; this is
+ * the consumer-side guard, and both are wanted (TASK_2026_376 R1).
+ */
+const INTERNAL_QUERY_SESSION_PREFIX = 'internal-query-';
+
+/**
+ * Which mechanism deferred a pass, as the diagnostics event reports it.
+ *
+ * The `reason` already names the event; `source` names the thing that produced
+ * it, which is what an operator needs to know where to look. The three are
+ * different subsystems: the internal-query concurrency gate, this service's own
+ * pass queue, and the caller itself.
+ */
+const DEFERRAL_SOURCES = {
+  'concurrency-slot-timeout': 'internal-query-gate',
+  'curator-queue-wait-timeout': 'curator-job-queue',
+  'caller-aborted': 'caller',
+} as const;
+
 /**
  * Whether the pass reached the model at all — TASK_2026_306 Batch 10 (F1).
  *
@@ -81,14 +118,22 @@ const MANUAL_COMPACTION_MAX_WINDOWS = 1;
  * pass before it could dispatch, so the input is untouched and the caller must
  * leave it exactly where it found it.
  *
- * Two gates produce `'stalled'`, and the caller treats them identically because
- * the fact it acts on is the same one: nothing was curated and nothing was
- * consumed. The provider quota gate stops a pass that would dial a rate-limited
- * provider (TASK_2026_306). The internal-query concurrency gate stops a pass
- * that could not win a slot within `ptah.internalQuery.queueTimeoutMs`
- * (TASK_2026_376 F4) — that one used to be reported as `'ran'` with
- * `extracted: 0`, which is how two sessions had their observation rows marked
- * processed for a curation that never happened.
+ * Several gates produce `'stalled'`, and the caller treats them identically
+ * because the fact it acts on is the same one: nothing was curated and nothing
+ * was consumed. The provider quota gate stops a pass that would dial a
+ * rate-limited provider (TASK_2026_306). The internal-query concurrency gate
+ * stops a pass that could not win a slot within
+ * `ptah.internalQuery.queueTimeoutMs` (TASK_2026_376 F4) — that one used to be
+ * reported as `'ran'` with `extracted: 0`, which is how two sessions had their
+ * observation rows marked processed for a curation that never happened. R1 adds
+ * three more with the same property: a pass that waited past
+ * `CURATOR_QUEUE_WAIT_CEILING_MS` for its turn in `CuratorJobQueue`, a pass
+ * whose caller had already aborted, and a pass whose model spent its turns and
+ * returned no JSON (`recordCuratorNoOutput`).
+ *
+ * Note what is NOT on this list: a pass that dispatched and whose call FAILED
+ * still reports `'ran'` (`recordCuratorError`). Every `'stalled'` member is a
+ * pass whose input was demonstrably never read.
  *
  * Required, not optional, so every construction site has to answer. The zero
  * counts on the two arms are identical, which is precisely why the counts
@@ -156,6 +201,13 @@ export class MemoryCuratorService {
   start(): void {
     if (this.disposer) return;
     this.disposer = this.registry.register((data) => {
+      if (data.sessionId.startsWith(INTERNAL_QUERY_SESSION_PREFIX)) {
+        this.logger.debug(
+          '[memory-curator] ignoring a PreCompact fan-out for an internal one-shot query; it names no session',
+          { sessionId: data.sessionId, trigger: data.trigger },
+        );
+        return;
+      }
       this.running = (async () => {
         const cwd =
           typeof data.cwd === 'string' && data.cwd.length > 0 ? data.cwd : null;
@@ -299,6 +351,23 @@ export class MemoryCuratorService {
           () => this.doCurate(input),
         ),
       )
+      .catch((error: unknown) => {
+        // A pass that never got its turn is a deferral, not a failure: no
+        // prompt was sent and the input is exactly where it was. Reporting it
+        // as a rejection would surface a stack trace on the `memory:runNow`
+        // RPC and, worse, let the trigger service's error path decide what to
+        // do with observations that were never read (TASK_2026_376 R1).
+        if (error instanceof CuratorQueueWaitTimeoutError) {
+          return this.recordCuratorDeferral(input.sessionId, {
+            reason: 'curator-queue-wait-timeout',
+            stage: 'extract',
+            completedWindows: 0,
+            windows: 0,
+            retriesSpent: 0,
+          });
+        }
+        throw error;
+      })
       .finally(() => {
         if (key !== null) this.inFlight.delete(key);
       });
@@ -429,6 +498,21 @@ export class MemoryCuratorService {
     signal?: AbortSignal;
     maxWindows?: number;
   }): Promise<CuratorRunStats> {
+    // A pass can sit in the job queue for minutes, and the caller that queued it
+    // may have withdrawn in that time. Running the pipeline for it would spend a
+    // provider call and a lane slot on a result nobody reads, and would consume
+    // the session's observations to produce it (TASK_2026_376 R1). The abort is
+    // checked again between windows by `CuratorWindowRunner`; this is the one
+    // check that happens before any work at all.
+    if (input.signal?.aborted) {
+      return this.recordCuratorDeferral(input.sessionId, {
+        reason: 'caller-aborted',
+        stage: 'extract',
+        completedWindows: 0,
+        windows: 0,
+        retriesSpent: 0,
+      });
+    }
     const transcript =
       (input.transcript ?? '').trim() || TRANSCRIPT_PLACEHOLDER;
     const tier: MemoryTier = input.tier ?? 'recall';
@@ -466,6 +550,7 @@ export class MemoryCuratorService {
     );
     if (extraction.status === 'deferred') {
       return this.recordCuratorDeferral(input.sessionId, {
+        reason: 'concurrency-slot-timeout',
         stage: 'extract',
         completedWindows: extraction.completedWindows,
         windows: windows.length,
@@ -491,6 +576,9 @@ export class MemoryCuratorService {
     if (extraction.status === 'stalled') {
       return this.recordCuratorStall(input.sessionId, extraction);
     }
+    if (extraction.status === 'no-output') {
+      return this.recordCuratorNoOutput(input.sessionId, extraction);
+    }
     const drafts = extraction.drafts;
     if (drafts.length === 0) {
       const emptyStats: CuratorRunStats = {
@@ -537,6 +625,7 @@ export class MemoryCuratorService {
       // here would mark the observation rows processed and lose the session.
       if (isQueueSlotTimeout(error) && !input.signal?.aborted) {
         return this.recordCuratorDeferral(input.sessionId, {
+          reason: 'concurrency-slot-timeout',
           stage: 'resolve',
           completedWindows: windows.length,
           windows: windows.length,
@@ -703,6 +792,61 @@ export class MemoryCuratorService {
     };
   }

+  /**
+   * The curator ran and never wrote its answer — TASK_2026_376 R1.
+   *
+   * The curator reached the model, spent turns, and got no JSON back: it filled
+   * its budget with tool calls, or it said nothing at all. The pass therefore
+   * extracted nothing from a transcript it never reported on, which is NOT the
+   * same event as a pass that read the transcript and honestly found nothing
+   * durable in it — and the caller acts on the difference.
+   * `MemoryTriggerService.invokeCurate` marks the drained `observation_queue`
+   * rows processed for a run, so reporting `'ran'` here consumed the very
+   * observations that were never curated, and the session could never be
+   * curated again. Six turns (F8) made this the ordinary shape of a tool-using
+   * run rather than a theoretical one.
+   *
+   * `'stalled'` is therefore the honest outcome, for the same reason it is the
+   * honest outcome of a quota stop: nothing usable came back, so leave the input
+   * where it is. Same shape as {@link recordCuratorStall} — no `lastRunAtMs`, no
+   * `curator-run`, nothing persisted.
+   *
+   * The cost of being wrong is bounded and asymmetric. A model that answers this
+   * way on every pass re-curates the same session each drain, which spends
+   * prompts; consuming the input instead loses the session's memories for good.
+   */
+  private recordCuratorNoOutput(
+    sessionId: string,
+    extraction: Extract<CuratorExtraction, { status: 'no-output' }>,
+  ): CuratorRunStats {
+    this.pushEvent({
+      kind: 'rate-limited',
+      timestamp: Date.now(),
+      sessionId,
+      stats: {
+        source: 'curator-llm',
+        reason: 'no-output',
+        usedTools: extraction.usedTools,
+        toolNames: extraction.toolNames.join(','),
+      },
+    });
+    this.logger.warn(
+      '[memory-curator] curation pass returned no JSON; input left untouched for the next pass',
+      {
+        sessionId,
+        usedTools: extraction.usedTools,
+        toolNames: extraction.toolNames,
+      },
+    );
+    return {
+      outcome: 'stalled',
+      extracted: 0,
+      merged: 0,
+      created: 0,
+      skipped: 0,
+    };
+  }
+
   /**
    * Re-submit the resolve call while the pass can still afford it.
    *
@@ -733,8 +877,8 @@ export class MemoryCuratorService {
   }

   /**
-   * The internal-query concurrency gate stopped this pass before it could
-   * dispatch — TASK_2026_376 F4.
+   * A gate stopped this pass before it could dispatch — TASK_2026_376 F4, and
+   * two more gates in R1.
    *
    * Deliberately the same shape as {@link recordCuratorStall}, because the
    * caller's decision is the same one: the input was not consumed, so leave it
@@ -745,13 +889,23 @@ export class MemoryCuratorService {
    * The event is `rate-limited` rather than a new kind. `MemoryCuratorEventKind`
    * is consumed by the Activity surface, which already renders that kind as a
    * warning meaning "a gate stopped this"; the `reason` in `stats` is what tells
-   * the two gates apart, and `stats` is a free-form record. A new kind would be
-   * a frontend change for a distinction the frontend does not draw — and this
-   * batch may not touch the frontend.
+   * the gates apart, and `stats` is a free-form record. A new kind would be a
+   * frontend change for a distinction the frontend does not draw.
    */
   private recordCuratorDeferral(
     sessionId: string,
     detail: {
+      /**
+       * Which gate stopped the pass. All three share this method because the
+       * caller's decision is identical — the input was never read — and they
+       * are named apart because an operator diagnosing a quiet curator needs
+       * to know whether the host is congested, the queue is backed up, or the
+       * caller simply withdrew.
+       */
+      readonly reason:
+        | 'concurrency-slot-timeout'
+        | 'curator-queue-wait-timeout'
+        | 'caller-aborted';
       readonly stage: 'extract' | 'resolve';
       readonly completedWindows: number;
       readonly windows: number;
@@ -763,8 +917,8 @@ export class MemoryCuratorService {
       timestamp: Date.now(),
       sessionId,
       stats: {
-        source: 'internal-query-gate',
-        reason: 'concurrency-slot-timeout',
+        source: DEFERRAL_SOURCES[detail.reason],
+        reason: detail.reason,
         stage: detail.stage,
         completedWindows: detail.completedWindows,
         windows: detail.windows,
@@ -772,7 +926,7 @@ export class MemoryCuratorService {
       },
     });
     this.logger.warn(
-      '[memory-curator] curation pass could not win a concurrency slot; input left untouched for the next pass',
+      '[memory-curator] curation pass never dispatched; input left untouched for the next pass',
       { sessionId, ...detail },
     );
     return {
```
