# Batch R2 report — TASK_2026_376

**Scope:** style finding 1, logic finding 5, logic finding 6.
**Base commit:** `eca2c155b` (the reviewed commit), working tree.

| Finding                                                                     | Outcome                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Style 1 — `toolCallId` bypasses the source-of-truth wire schema             | **Closed.** The field is now modeled once, in `SdkSubagentEndedPayloadSchema`. |
| Logic 5 — an invalid optional `toolCallId` drops the whole payload          | **Closed.** Invalid means absent, on both the schema and the parser.           |
| Logic 6 — no repair when `SubagentStop` precedes `background_agent_started` | **Not implemented, with evidence.** See the section below.                     |

---

## Findings 1 and 5 — one change, because they are one decision

The two findings pull in opposite directions until you name the field's role.
Finding 1 says the Zod schema must define `toolCallId`. Finding 5 says an
invalid `toolCallId` must not reject the payload. A plain
`z.string().min(1).optional()` satisfies finding 1 and violates finding 5,
because Zod would then reject a payload carrying `toolCallId: ''`.

`z.string().min(1).optional().catch(undefined)` satisfies both. `toolCallId` is
a correlation id, not part of the terminal signal. An invalid value costs the
re-key. Dropping the payload costs the terminal state of every background agent
in that session, which is the defect F1 was filed to repair.

I verified the combinator's runtime behavior against the installed zod 4.3.6
rather than assuming it:

```
key absent            -> accepted, key ABSENT from output
key = 'tool'          -> accepted, key present, value 'tool'
key = ''              -> accepted, key present, value undefined
key = undefined       -> accepted, key present, value undefined
key = 42 | null | {}  -> accepted, key present, value undefined
```

I also verified that Zod emits output keys in SHAPE order, not input order.
That is why `toolCallId` sits between `agentType` and `lastAssistantMessage` in
the schema: `parseSdkSubagentEndedPayload` writes it there, and the equivalence
proof asserts key order.

### What changed

1. **`sdk-hook.schemas.ts:109`** — the schema declares the field. The docblock
   records why `.catch(undefined)` is load-bearing and why the key sits where it
   sits.
2. **`sdk-hook.parsers.ts:211`** — a local `readOptionalCaught` helper mirrors
   `<schema>.optional().catch(undefined)`. `readOptional` in
   `wire-guards.internal.ts` mirrors plain `.optional()` and returns `false` on
   an invalid present key, which is the reject path finding 5 is about. I did
   not change `readOptional`: `parseSdkBackgroundTaskSummary` still needs it for
   `command`, and `wire-guards.internal.ts` is outside this batch's write
   boundary. The helper is local because
   `SdkSubagentEndedPayloadSchema` is the only schema using the combinator; the
   docblock says to promote it when a second schema needs it.
3. **`sdk-hook.parsers.ts:222`** — the divergence docblock is deleted. The
   parser is once again the exact twin of its schema, so the file header's rule
   holds without an exception.
4. **`sdk-hook.types.ts:143-149`** — the wire type records the same rule.
5. **`session-lifecycle-notifier.ts:180`** — broadcasts `parsed.data`, like its
   two sibling handlers. The hand reattachment is gone.

### Diff — production code

```diff
diff --git a/libs/shared/src/lib/types/sdk-hook.schemas.ts b/libs/shared/src/lib/types/sdk-hook.schemas.ts
-/** Zod schema for {@link SdkSubagentEndedPayload}. */
+/**
+ * Zod schema for {@link SdkSubagentEndedPayload}.
+ *
+ * `toolCallId` is the one OPTIONAL field, and its `.catch(undefined)` is
+ * load-bearing. It is a correlation id, not a required part of the terminal
+ * signal: a peer of a different version that puts a blank or non-string value
+ * on the key must still deliver the payload, because dropping it leaves every
+ * background agent of that session stuck in `running` — the exact symptom
+ * TASK_2026_376 F1 was filed to repair. `.catch(undefined)` therefore accepts
+ * the payload and treats an invalid value as absent, while `.min(1)` keeps the
+ * rule that `''` is never an id. The REQUIRED fields still reject.
+ *
+ * The key sits between `agentType` and `lastAssistantMessage` because Zod emits
+ * output keys in SHAPE order, and `parseSdkSubagentEndedPayload` — proven
+ * key-order-identical in `wire-parsers.equivalence.spec.ts` — writes it there.
+ */
 export const SdkSubagentEndedPayloadSchema = z.object({
   sessionId: z.string().min(1),
   cwd: z.string().min(1),
   agentId: z.string().min(1),
   agentType: z.string().min(1),
+  toolCallId: z.string().min(1).optional().catch(undefined),
   lastAssistantMessage: z.string().nullable(),
   backgroundTasks: z.array(SdkBackgroundTaskSummarySchema).readonly(),
   timestamp: z.number().int().nonnegative(),
 });

diff --git a/libs/shared/src/lib/types/sdk-hook.parsers.ts b/libs/shared/src/lib/types/sdk-hook.parsers.ts
 /**
- * Mirrors `SdkSubagentEndedPayloadSchema`, with ONE deliberate difference:
- * this parser keeps the optional `toolCallId`, and the Zod schema does not
- * declare it, so `safeParse` strips it.
+ * Mirrors `<schema>.optional().catch(undefined)` on an object property.
  *
- * The divergence is confined to that key. Acceptance is identical on every
- * input, and `SessionLifecycleNotifier` puts the field back on the wire
- * explicitly after its `safeParse` call rather than letting a stripped field
- * travel silently. Add `toolCallId: z.string().min(1).optional()` to
- * `SdkSubagentEndedPayloadSchema` and this note goes away — the equivalence
- * corpus in `wire-parsers.equivalence.spec.ts` does not carry the key today,
- * so it cannot catch the gap on its own.
+ * The difference from {@link readOptional} is the failure posture, and it is
+ * the whole point: an invalid value on a present key is NOT fatal to the
+ * payload. Zod's contract, verified against zod 4.3.6:
+ * - key absent from input → key absent from output
+ * - key present, value valid → key present with that value
+ * - key present, value `undefined` or invalid → key present with `undefined`
+ *
+ * There is no counterpart in `wire-guards.internal.ts` because
+ * `SdkSubagentEndedPayloadSchema` is the only schema using the combinator.
+ * Promote it there when a second schema needs it.
  */
+function readOptionalCaught<T>(
+  source: Record<string, unknown>,
+  key: string,
+  check: (value: unknown) => value is T,
+  assign: (value: T | undefined) => void,
+): void {
+  if (!(key in source)) return;
+  const raw = source[key];
+  assign(check(raw) ? raw : undefined);
+}
+
+/** Mirrors `SdkSubagentEndedPayloadSchema`. */
 export function parseSdkSubagentEndedPayload(
   payload: unknown,
 ): SdkSubagentEndedPayload | null {
@@
     agentId: payload['agentId'],
     agentType: payload['agentType'],
   };
-  // Mirrors `z.string().min(1).optional()`: absent is accepted, present-and-
-  // blank is rejected. A blank toolCallId is not an identity — it would key a
-  // store entry that nothing can address.
-  const ok = readOptional(payload, 'toolCallId', isNonEmptyWireString, (v) => {
+  readOptionalCaught(payload, 'toolCallId', isNonEmptyWireString, (v) => {
     out['toolCallId'] = v;
   });
-  if (!ok) return null;
   out['lastAssistantMessage'] = payload['lastAssistantMessage'];
   out['backgroundTasks'] = backgroundTasks;
   out['timestamp'] = payload['timestamp'];

diff --git a/libs/shared/src/lib/types/sdk-hook.types.ts b/libs/shared/src/lib/types/sdk-hook.types.ts
    * Optional because the SDK does not guarantee a `toolUseID` on every hook
    * invocation, and a payload without it must behave exactly as it did before
-   * this field existed.
+   * this field existed. It is a correlation id, not part of the terminal
+   * signal, so `SdkSubagentEndedPayloadSchema` and
+   * `parseSdkSubagentEndedPayload` both treat an INVALID value on a present
+   * key as absent rather than dropping the payload. `''` is still never an id.

diff --git a/libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts b/libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts
-    // `SdkSubagentEndedPayloadSchema` does not declare `toolCallId`, so
-    // `safeParse` strips it. The field is re-attached here, from the same bus
-    // event Zod just accepted and under the same non-empty-string rule
-    // `parseSdkSubagentEndedPayload` applies on the webview side. Validation of
-    // every required field — and the drop above — is unchanged.
-    const toolCallId = event.toolCallId;
-    const payload: SdkSubagentEndedPayload =
-      typeof toolCallId === 'string' && toolCallId.length > 0
-        ? { ...parsed.data, toolCallId }
-        : parsed.data;
+    const payload: SdkSubagentEndedPayload = parsed.data;
```

### Diff — the equivalence corpus

The whole-corpus proof builds its inputs from a canonical payload, crossing
every key with 50 hostile values and also deleting each key. `SUBAGENT_ENDED`
did not carry `toolCallId`, so the corpus could not reach the field — the
parser's own docblock said so before this batch. Adding the key to the base
makes the pin automatic instead of hand-written.

```diff
diff --git a/libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts b/libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts
+/**
+ * Carries `toolCallId` so `buildCorpus` crosses that key with every hostile
+ * value and also deletes it. That is what pins the ONE field whose schema and
+ * parser were allowed to disagree before TASK_2026_376 R2: it is
+ * `.optional().catch(undefined)`, so an invalid value must be treated as
+ * absent on BOTH sides rather than rejecting the payload.
+ */
 const SUBAGENT_ENDED = {
   sessionId: UUID_V4,
   cwd: 'D:/repo',
   agentId: 'agent-1',
   agentType: 'Explore',
+  toolCallId: 'toolu_01XJafA4f3zy645GaBXbwZ7F',
   lastAssistantMessage: null,
   backgroundTasks: [],
   timestamp: 3,
 };
@@
       [
         { ...SUBAGENT_ENDED, backgroundTasks: [BACKGROUND_TASK] },
         { ...SUBAGENT_ENDED, lastAssistantMessage: 'done' },
+        // `.catch(undefined)` accepts these three and publishes no id; the
+        // required fields below still reject.
+        { ...SUBAGENT_ENDED, toolCallId: '' },
+        { ...SUBAGENT_ENDED, toolCallId: undefined },
+        { ...SUBAGENT_ENDED, toolCallId: 42 },
+        { ...SUBAGENT_ENDED, toolCallId: '', agentId: '' },
       ],
```

> **Write-boundary note.** `wire-parsers.equivalence.spec.ts` is not on this
> batch's file list, but the batch brief asks to "extend the equivalence corpus
> that pins schema/parser agreement", and that corpus lives only in this file.
> The change is additive, touches one canonical payload and four extra inputs,
> and no other batch owns `libs/shared`. Flagging it so the orchestrator can
> revert it if the boundary was meant literally — findings 1 and 5 are still
> pinned without it, by the specs listed below.

### Specs added

`libs/shared/src/lib/types/sdk-hook.parsers.spec.ts` was rewritten so every case
asserts the parser AND the schema agree — same accept/reject, same value, same
key order — through one `expectSchemaAgreement` helper. The three cases the
brief asked for:

- `keeps a non-empty toolCallId` — schema and parser agree on a valid value.
- `parses a payload without toolCallId and leaves the key absent` — agree on
  absence.
- `delivers the payload when toolCallId is invalid, treating it as absent` —
  agree on `''`, `0`, `1`, `true`, `false`, `null`, `[]`, `{}`, `['toolu_a']`
  and `NaN`. Each case asserts the payload is DELIVERED, that `toolCallId` is
  `undefined`, and that `agentId` survives, so the terminal signal still works.

Two more pin the constraints that must not move:

- `never publishes a blank toolCallId` — `''` is never an id.
- `still rejects a malformed required field alongside a valid toolCallId` —
  `.catch(undefined)` widens exactly one key, not the payload.

`session-lifecycle-notifier.spec.ts`: the test asserting `'toolCallId' in
payload === false` for a blank id was wrong under the new contract — Zod now
emits the key with `undefined`. It is replaced by `publishes no id for a blank
toolCallId, and still delivers the payload`, which asserts `calls` has length 1.
A second new test does the same for a non-string. The forwarding test now sends
an unknown key and asserts it is stripped, which proves the broadcast payload is
`safeParse().data` rather than a hand-built object.

---

## Finding 6 — recorded, not implemented

I traced the ordering and I recommend leaving this open. Two reasons, both with
evidence.

### 1. The producer order is causal, and the delivery window that could invert it is one frame

`background_agent_started` is built when the SDK returns **the immediate
placeholder tool_result** for a `run_in_background: true` Task
(`libs/backend/agent-sdk/src/lib/message-transform/background-started-event.ts:2-3`).
That is the START of the subagent's life. `SubagentStop` fires at its end. So the
started event is always CREATED first, and the only way to invert the pair is in
delivery.

The two messages take different transports to the same webview:

- The started event goes into `StreamBatchBuffer`
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:228`),
  which coalesces for one frame — `STREAM_BATCH_INTERVAL_MS = 16`
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.ts:46`).
- The terminal push calls `broadcastMessage` directly, with no buffer
  (`libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:182`).

So the inversion window is the buffer's flush delay — 16 ms, or longer only
while the transport window at `stream-batch-buffer.ts:63`
(`STREAM_BATCH_MAX_IN_FLIGHT = 4`) is saturated. It is measured against the
subagent's whole remaining lifetime, which contains at least one model round
trip. The window is not provably zero, but it is a frame against seconds.

### 2. The suggested repair does not close it

The review proposes a bounded `toolCallId → agentId` map consulted in
`BackgroundAgentStore.onStarted`. That fixes only the sub-case where the started
event carries no `agentId` — and in this ordering it usually does carry one.
`background-started-event.ts:64` reads `record?.agentId` at BUILD time, not
delivery time, and `SubagentRegistryService` deletes the record at completion
(`libs/backend/vscode-core/src/services/subagent-registry.service.ts:318`),
which is after the build. An agent that lived long enough to start and stop has
almost certainly fired `SubagentStart` first, so the event carries a real
`agentId` and `resolveKey` files it correctly.

The entry is therefore stuck for a different reason than the review states: the
only terminal signal passed **before the entry existed**. Closing that needs a
bounded set of already-stopped agents consulted in `onStarted`, keyed on both
identity spaces, plus an eviction policy and a decision about a pairing that is
never matched. That is a larger change than the review scoped, for a window
bounded by a 16 ms coalescing timer, on a finding the reviewer already marked
LOW, pre-existing and non-blocking.

**Recommendation:** carry finding 6 forward as its own task with the reframing
above, rather than fitting a partial repair into this batch.

---

## Verification

Project names read from each `project.json`: `@ptah-extension/shared`,
`@ptah-extension/rpc-handlers`, `@ptah-extension/chat`,
`@ptah-extension/chat-streaming`.

```
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers \
  @ptah-extension/chat @ptah-extension/chat-streaming --skip-nx-cache

 NX   Running target test for 4 projects:
> nx run @ptah-extension/shared:test
Test Suites: 54 passed, 54 total
Tests:       1280 passed, 1280 total
> nx run @ptah-extension/chat-streaming:test
Test Suites: 20 passed, 20 total
Tests:       1 skipped, 409 passed, 410 total
> nx run @ptah-extension/rpc-handlers:test
Test Suites: 93 passed, 93 total
Tests:       31 skipped, 2708 passed, 2739 total
> nx run @ptah-extension/chat:test
Test Suites: 61 passed, 61 total
Tests:       2 skipped, 940 passed, 942 total
 NX   Successfully ran target test for 4 projects
```

The header reports 4 projects, which is the number requested.

```
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers \
  @ptah-extension/chat @ptah-extension/chat-streaming

 NX   Successfully ran target typecheck for 4 projects
```

```
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/rpc-handlers

✖ 19 problems (0 errors, 19 warnings)
 NX   Successfully ran target lint for 2 projects
```

All 19 warnings are pre-existing `max-lines`, unused-import and
non-null-assertion warnings in files this batch did not touch. Prettier reports
all six changed files clean.

### One intermittent failure, in a file this batch did not touch

Across seven runs of the four-project command, three runs failed one test:

```
● adoptLegacySkillsShInstalls — what the lockfile attests
  › is idempotent — a second sweep finds nothing left to do
  at src/lib/skills-sh/skills-sh-source-root.service.spec.ts:181
Test Suites: 1 failed, 92 passed, 93 total
```

Evidence that it is unrelated to this batch:

- `skills-sh-source-root.service.spec.ts` is not in this batch's diff and is not
  modified in the working tree.
- `npx nx test @ptah-extension/rpc-handlers` alone passes 93/93.
- `npx nx test @ptah-extension/rpc-handlers -t "is idempotent"` passes.
- The two-project run (`shared` + `rpc-handlers`) passes.
- Nx itself reported `Nx detected a flaky task: @ptah-extension/rpc-handlers:test`.

It fails only under the heaviest parallel load, which points at a shared
temporary directory or a timing assumption in that suite. I did not investigate
further: the file is outside this batch's write boundary. It is worth its own
task.

## Files changed

| File                                                               | Change                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| `libs/shared/src/lib/types/sdk-hook.schemas.ts`                    | `toolCallId` modeled once, with its rationale        |
| `libs/shared/src/lib/types/sdk-hook.parsers.ts`                    | `readOptionalCaught` mirror; divergence note deleted |
| `libs/shared/src/lib/types/sdk-hook.types.ts`                      | Doc comment records the invalid-means-absent rule    |
| `libs/shared/src/lib/types/sdk-hook.parsers.spec.ts`               | Every case now asserts schema/parser agreement       |
| `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts`       | Corpus reaches `toolCallId` (see boundary note)      |
| `libs/backend/rpc-handlers/.../session-lifecycle-notifier.ts`      | Broadcasts `parsed.data`                             |
| `libs/backend/rpc-handlers/.../session-lifecycle-notifier.spec.ts` | Expectations follow the new contract                 |

`background-agent.store.ts` and `turn-end-handler.service.ts` are unchanged —
see the finding 6 section.
