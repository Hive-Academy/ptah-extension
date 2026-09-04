# B5 report — F8: `maxTurns: 1` defeats the curator's tool access

Batch: B5 of TASK_2026_376. Write boundary:
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/**`. Nothing outside it was
edited.

---

## 1. `maxTurns` semantics — what was verified, and where

Read out of the installed package, not from memory. Version confirmed at
`node_modules/@anthropic-ai/claude-agent-sdk/package.json` -> `0.3.150` (the
pinned version).

All four facts come from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

| Line         | What it says                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `:1527-1530` | `Options.maxTurns` — "Maximum number of conversation turns before the query stops. A turn consists of a user message and assistant response." |
| `:73-75`     | `AgentDefinition.maxTurns` — "Maximum number of agentic turns (**API round-trips**) before stopping". This is the line that fixes the unit.   |
| `:3402`      | `SDKResultError.subtype` includes `'error_max_turns'`.                                                                                        |
| `:5687`      | `TerminalReason` includes `'max_turns'`.                                                                                                      |

One more fact, from the bundle
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`: the option is forwarded
to the child process as the CLI flag `--max-turns`. The ceiling is enforced by
the `claude` binary, not by this process.

Two consequences decide the fix:

1. **One turn is one API round-trip.** `maxTurns: 1` buys exactly one assistant
   response. The model may emit `tool_use` blocks in it and the SDK will run the
   tools, but returning the `tool_result` to the model requires a SECOND
   round-trip. That round-trip never happens. The finding is confirmed exactly
   as written: the MCP wiring attached three lines above `maxTurns` was
   unreachable.
2. **Exhausting the budget is a RESULT, not a throw.** The stream ends with a
   `result` message carrying `subtype: 'error_max_turns'`. The old collector
   read no field off the `result` message, so an exhausted budget was completely
   invisible. The new collector reads `subtype` and warns.

---

## 2. The number chosen: `CURATOR_MAX_TURNS = 6`

- **Floor is 2.** Call, observe, answer. Anything below 2 reproduces the defect.
- **6 = floor plus one short chain.** Search memory, read a file the transcript
  named, then answer. That is the shape curation actually has.
- **It stays a bound, and a small one.** `DEFAULT_ONE_SHOT_MAX_TURNS` is 25
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:66`). The
  curator asks for under a quarter of it, because it runs on a lane whose
  `perLaneLimit` is 1 behind a 60-second queue budget. Every turn this run
  spends is a turn the next curation window waits, and a window that waits past
  the budget is **dropped** — that is F4 in the same task. A generous ceiling
  here is not free latency, it is the next window's data loss. That trade is
  written into the constant's docblock so the next person to raise it sees it.

`lane: 'memory-curator'` is untouched. The cooling-down / auth-resolution block
above line 278 is untouched.

---

## 3. The collector

`CuratorQueryOutcome` gained two arms. It had `text` and `cooling-down`; it now
has `text`, `tools-only`, `silent` and `cooling-down`.

- `tool_use` blocks are counted and named. The old loop read `text` blocks only,
  so a run that searched memory and read three files contributed the empty
  string.
- `text` (non-empty) -> parsed as before, and now also carries `toolUses`.
- `tools-only` -> logged at INFO, naming the tools, with the count.
- `silent` -> logged at WARN, with a different message.
- `error_max_turns` on the `result` message -> a separate WARN naming
  `maxTurns`, `toolUses` and `toolNames`.

**A limit worth stating plainly.** The `CuratorExtraction` contract has two arms
(`extracted` / `stalled`) and lives in
`libs/backend/memory-contracts/src/lib/curator-llm.port.ts`, which is outside
this batch's write boundary — as is `libs/backend/memory-curator/**`, the caller
that would consume a third arm (B3 owns it). So `tools-only` and `silent` both
still return `{ status: 'extracted', drafts: [] }` to the typed caller. What
this batch could deliver, and did, is that the two are distinguishable in the
**log** and in the adapter's own type. **Making the distinction reach the typed
caller requires a follow-up that adds an arm to `CuratorExtraction` and handles
it in `MemoryCuratorService`.** It is filed here rather than done, because doing
it would cross into another agent's files.

`tools-only` deliberately resolves `extracted`, not `stalled`: a tool-only pass
DID its work, and stalling would tell `MemoryTriggerService` to hold episodes
that were already curated.

---

## 4. The system prompt — it did not mention tools, and it discouraged them

Both prompts are assembled inside this batch's boundary
(`curator-llm-adapter/extract-prompt.ts` and `resolve-prompt.ts`), so both were
fixed here. Nothing outside the boundary needed to change for this.

The prompts named no tool at all. Worse, each ended with **"Respond ONLY with a
JSON object"** and each user prompt ended with **"Return ONLY the JSON
object."** — an instruction that reads as "do not call tools". Raising the turn
budget alone would have left the model told not to use the turns.

Added to both a `TOOLS` section that:

- states the access is full and pre-approved and that nothing will prompt anyone
  (this is the F5 maintainer decision, stated to the model that has to act on
  it);
- names real tools, verified against
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
  and the MCP server key `ptah` from `SdkQueryRunner.buildOneShotMcpServers`, so
  the prefix `mcp__ptah__` is correct: `ptah_memory_search`,
  `ptah_search_files`, `ptah_code_search_symbols`, plus `Read` / `Grep` from the
  `claude_code` preset;
- says only what the host actually lists is available (`ptah_memory_search` is
  present only where the SQLite layer is), so the model does not invent tools;
- caps the chain — "keep it to a few calls, another curation window is queued
  behind you" — which is the prompt-side half of the bound;
- ends with "your FINAL message must contain ONLY the JSON object. A tool call
  is never the end of your work — the JSON is."

The two user-prompt tails became "Return ONLY the JSON object **as your final
message**."

---

## 5. Files changed

```
extract-prompt.ts                          |  19 +-
resolve-prompt.ts                          |  12 +-
sdk-internal-query.curator-llm.ts          | 136 +-
sdk-internal-query.curator-llm.spec.ts     | 201 +++
4 files changed, 359 insertions(+), 9 deletions(-)
```

All four under `libs/backend/agent-sdk/src/lib/curator-llm-adapter/`.

## 6. The exact diff

```diff
diff --git a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts
index 667b7778a..83b821cf4 100644
--- a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts
+++ b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts
@@ -31,8 +31,23 @@ a JSON object of the form:
 - Any of request/investigated/learned/completed/nextSteps may be null when not
   applicable to the memory.
 Skip transient chit-chat, code that is already in the repo, and anything
-private to a single message.`;
+private to a single message.
+
+TOOLS
+You have full, pre-approved access to the host's tools. Nothing you call will
+prompt anyone — use them whenever they make the extraction more accurate.
+Useful ones, when the host lists them:
+- mcp__ptah__ptah_memory_search — what is already remembered, so you do not
+  re-extract it and so "subject" matches the key an existing memory used.
+- mcp__ptah__ptah_search_files, mcp__ptah__ptah_code_search_symbols, Read,
+  Grep — confirm a path or a symbol before you put it in "files".
+Rules for tool use:
+- Only what the host actually lists is available; do not assume a tool exists.
+- Keep it to a few calls. Your turn budget is small and another curation window
+  is queued behind you.
+- After the last tool result, your FINAL message must contain ONLY the JSON
+  object. A tool call is never the end of your work — the JSON is.`;

 export function buildExtractUserPrompt(transcript: string): string {
-  return `Transcript:\n"""\n${transcript}\n"""\n\nReturn ONLY the JSON object.`;
+  return `Transcript:\n"""\n${transcript}\n"""\n\nReturn ONLY the JSON object as your final message.`;
 }
diff --git a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts
index 1fb0f83df..72a3aa2c9 100644
--- a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts
+++ b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts
@@ -21,7 +21,15 @@ subject as one of the existing memories. Respond ONLY with a JSON object:
 }
 Prefer mergeTargetId when subjects match (case-insensitive). If unsure, set null.
 Preserve every structured field from the candidate (type/concepts/files and the
-five summary fields) unless the candidate omits them — never invent values.`;
+five summary fields) unless the candidate omits them — never invent values.
+
+TOOLS
+You have full, pre-approved access to the host's tools and nothing you call
+will prompt anyone. mcp__ptah__ptah_memory_search is the useful one here: the
+"Existing" list you are given is a shortlist, and a wider search can surface the
+memory a candidate really refines. Only what the host lists is available. Keep
+it to a few calls — your turn budget is small. After the last tool result, your
+FINAL message must contain ONLY the JSON object.`;

 export function buildResolveUserPrompt(
   drafts: readonly {
@@ -40,5 +48,5 @@ export function buildResolveUserPrompt(
   }[],
   related: readonly { id: string; subject: string | null; content: string }[],
 ): string {
-  return `Candidates:\n${JSON.stringify(drafts, null, 2)}\n\nExisting:\n${JSON.stringify(related, null, 2)}\n\nReturn ONLY the JSON object.`;
+  return `Candidates:\n${JSON.stringify(drafts, null, 2)}\n\nExisting:\n${JSON.stringify(related, null, 2)}\n\nReturn ONLY the JSON object as your final message.`;
 }
diff --git a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
index 7744ab7e3..c4fc4d191 100644
--- a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
+++ b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts
@@ -5,6 +5,7 @@ import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
 import {
   SdkInternalQueryCuratorLlm,
   CURATOR_DEFAULT_MODEL_TIER,
+  CURATOR_MAX_TURNS,
 } from './sdk-internal-query.curator-llm';
 import { CuratorLlmQueryError } from './curator-llm-query.error';
 import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
@@ -93,15 +94,40 @@ async function* streamFrom(text: string): AsyncIterable<unknown> {
   yield { type: 'result' };
 }

+/** An assistant content block as the SDK streams it. */
+type AssistantBlock =
+  | { type: 'text'; text: string }
+  | { type: 'tool_use'; name: string };
+
+/**
+ * A stream built from arbitrary assistant blocks, so a run whose whole
+ * contribution was tool calls can be replayed. `streamFrom` cannot express
+ * that — it only ever yields one text block (TASK_2026_376 F8).
+ */
+function streamOfBlocks(
+  blocks: readonly AssistantBlock[],
+  resultSubtype?: string,
+): () => AsyncIterable<unknown> {
+  return async function* () {
+    yield { type: 'assistant', message: { content: blocks } };
+    yield resultSubtype
+      ? { type: 'result', subtype: resultSubtype }
+      : { type: 'result' };
+  };
+}
+
 interface ExecuteCapture {
   model?: string;
   cwd?: string;
   auth?: OneShotAuthOverride;
   authWasPresent?: boolean;
+  maxTurns?: number;
 }

 function makeInternalQuery(opts: {
   text?: string;
+  blocks?: readonly AssistantBlock[];
+  resultSubtype?: string;
   throwOnExecute?: Error;
   capture?: ExecuteCapture;
 }): InternalQueryService {
@@ -110,15 +136,22 @@ function makeInternalQuery(opts: {
       async (config: {
         model: string;
         cwd: string;
+        maxTurns?: number;
         auth?: OneShotAuthOverride;
       }) => {
         if (opts.capture) {
           opts.capture.model = config.model;
           opts.capture.cwd = config.cwd;
+          opts.capture.maxTurns = config.maxTurns;
           opts.capture.auth = config.auth;
           opts.capture.authWasPresent = 'auth' in config;
         }
         if (opts.throwOnExecute) throw opts.throwOnExecute;
+        if (opts.blocks) {
+          return {
+            stream: streamOfBlocks(opts.blocks, opts.resultSubtype)(),
+          };
+        }
         return { stream: streamFrom(opts.text ?? '') };
       },
     ),
@@ -641,3 +674,171 @@ describe('SdkInternalQueryCuratorLlm — error vs empty', () => {
     });
   });
 });
+
+describe('SdkInternalQueryCuratorLlm — the turn budget (TASK_2026_376 F8)', () => {
+  it('asks for more than one turn, so a tool_result can reach the model', () => {
+    // One turn is one API round-trip (`Options.maxTurns`,
+    // @anthropic-ai/claude-agent-sdk sdk.d.ts:1527-1530). A tool call needs a
+    // second round-trip to carry its result back, so 1 makes the MCP wiring
+    // this adapter attaches unreachable. Two is the floor.
+    expect(CURATOR_MAX_TURNS).toBeGreaterThanOrEqual(2);
+  });
+
+  it('keeps the budget BOUNDED and below the one-shot default of 25', () => {
+    // The bound is not decoration. `perLaneLimit` is 1 on the memory-curator
+    // lane and the queue budget is 60s, so turns spent here are turns the next
+    // curation window waits before it is dropped (TASK_2026_376 F4).
+    expect(Number.isInteger(CURATOR_MAX_TURNS)).toBe(true);
+    expect(CURATOR_MAX_TURNS).toBeLessThan(25);
+  });
+
+  it('sends CURATOR_MAX_TURNS into the internal query, not a hard-coded 1', async () => {
+    const capture: ExecuteCapture = {};
+    const internalQuery = makeInternalQuery({
+      text: '{"memories":[]}',
+      capture,
+    });
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      internalQuery,
+      makeWorkspace(''),
+    );
+    await adapter.extract(EXTRACT_TRANSCRIPT);
+    expect(capture.maxTurns).toBe(CURATOR_MAX_TURNS);
+    expect(capture.maxTurns).not.toBe(1);
+  });
+});
+
+describe('SdkInternalQueryCuratorLlm — tool-only runs are not silent runs', () => {
+  const toolsOnly: readonly AssistantBlock[] = [
+    { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
+  ];
+
+  it('records a tool-only extract pass DISTINCTLY from a pass that produced nothing', async () => {
+    // The defect: both reach the caller as `extracted: 0`. The contract cannot
+    // carry a third arm from inside this batch, so the log is the seam — and
+    // the two must not print the same line.
+    const toolLogger = makeLogger();
+    await new SdkInternalQueryCuratorLlm(
+      toolLogger,
+      makeInternalQuery({ blocks: toolsOnly }),
+      makeWorkspace(''),
+    ).extract(EXTRACT_TRANSCRIPT);
+
+    const silentLogger = makeLogger();
+    await new SdkInternalQueryCuratorLlm(
+      silentLogger,
+      makeInternalQuery({ blocks: [] }),
+      makeWorkspace(''),
+    ).extract(EXTRACT_TRANSCRIPT);
+
+    const toolLines = [
+      ...(toolLogger.info as jest.Mock).mock.calls,
+      ...(toolLogger.warn as jest.Mock).mock.calls,
+    ];
+    const silentLines = [
+      ...(silentLogger.info as jest.Mock).mock.calls,
+      ...(silentLogger.warn as jest.Mock).mock.calls,
+    ];
+    expect(toolLines.length).toBeGreaterThan(0);
+    expect(silentLines.length).toBeGreaterThan(0);
+    expect(toolLines[0][0]).not.toEqual(silentLines[0][0]);
+  });
+
+  it('names the tools it used, so the pass can be told apart in a log', async () => {
+    const logger = makeLogger();
+    await new SdkInternalQueryCuratorLlm(
+      logger,
+      makeInternalQuery({
+        blocks: [
+          { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
+          { type: 'tool_use', name: 'Read' },
+        ],
+      }),
+      makeWorkspace(''),
+    ).extract(EXTRACT_TRANSCRIPT);
+
+    const call = (logger.info as jest.Mock).mock.calls.find((c) =>
+      String(c[0]).includes('through tools'),
+    );
+    expect(call).toBeDefined();
+    expect(call?.[1]).toEqual({
+      toolUses: 2,
+      toolNames: ['mcp__ptah__ptah_memory_search', 'Read'],
+    });
+  });
+
+  it('still resolves EXTRACTED (not stalled) after a tool-only pass', async () => {
+    // A tool-only pass DID the work. Stalling would tell the trigger service to
+    // keep the episodes, which is the opposite of what happened.
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({ blocks: toolsOnly }),
+      makeWorkspace(''),
+    );
+    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
+      status: 'extracted',
+      drafts: [],
+    });
+  });
+
+  it('parses the JSON normally when a run BOTH called tools and answered', async () => {
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({
+        blocks: [
+          { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
+          {
+            type: 'text',
+            text: '{"memories":[{"kind":"fact","subject":"ptah","content":"lanes exist","salienceHint":0.5}]}',
+          },
+        ],
+      }),
+      makeWorkspace(''),
+    );
+    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
+    expect(result.status).toBe('extracted');
+    expect(result.status === 'extracted' && result.drafts).toHaveLength(1);
+  });
+
+  it('warns when the run stopped at the turn ceiling', async () => {
+    // `error_max_turns` is a RESULT in this SDK, never a throw
+    // (sdk.d.ts:3402), so an exhausted budget is invisible unless it is read.
+    const logger = makeLogger();
+    await new SdkInternalQueryCuratorLlm(
+      logger,
+      makeInternalQuery({
+        blocks: toolsOnly,
+        resultSubtype: 'error_max_turns',
+      }),
+      makeWorkspace(''),
+    ).extract(EXTRACT_TRANSCRIPT);
+
+    const call = (logger.warn as jest.Mock).mock.calls.find((c) =>
+      String(c[0]).includes('turn ceiling'),
+    );
+    expect(call).toBeDefined();
+    expect(call?.[1]).toMatchObject({ maxTurns: CURATOR_MAX_TURNS });
+  });
+
+  it('stores drafts unmerged after a tool-only RESOLVE pass', async () => {
+    const adapter = new SdkInternalQueryCuratorLlm(
+      makeLogger(),
+      makeInternalQuery({ blocks: toolsOnly }),
+      makeWorkspace(''),
+    );
+    const drafts = [
+      {
+        kind: 'fact' as const,
+        subject: 'ptah',
+        content: 'lanes exist',
+        salienceHint: 0.5,
+      },
+    ];
+    await expect(
+      adapter.resolve(drafts, [
+        { id: 'm1', subject: 'ptah', content: 'older note' },
+      ]),
+    ).resolves.toEqual([{ ...drafts[0], mergeTargetId: null }]);
+  });
+});
diff --git a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
index c5aaf3f17..d1576eb5b 100644
--- a/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
+++ b/libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts
@@ -94,9 +94,25 @@ type CuratorAuthDecision =
  * distinction is unrecoverable. Carrying it here — the earliest point it
  * exists — is what lets `extract` publish `status: 'stalled'` without
  * reconstructing anything.
+ *
+ * The same collapse happened a second time, one layer down, and TASK_2026_376
+ * F8 is that repeat. With tools reachable (`resolveMcpSessionWiring` below) a
+ * run can spend every turn calling them and emit no assistant text at all. The
+ * old collector gathered text ONLY, so that run reached the caller as `''` —
+ * byte-identical to a model that answered nothing, and byte-identical to a run
+ * that never started. Three different events, one value. `tools-only` and
+ * `silent` are separate arms for the same reason `cooling-down` is: the caller
+ * acts differently on them, and a discriminator is the only thing a `''` cannot
+ * be mistaken for.
  */
 type CuratorQueryOutcome =
-  | { readonly kind: 'text'; readonly text: string }
+  | { readonly kind: 'text'; readonly text: string; readonly toolUses: number }
+  | {
+      readonly kind: 'tools-only';
+      readonly toolUses: number;
+      readonly toolNames: readonly string[];
+    }
+  | { readonly kind: 'silent' }
   | { readonly kind: 'cooling-down'; readonly providerId: string };

 /**
@@ -119,6 +135,49 @@ type CuratorQueryOutcome =
  */
 export const CURATOR_DEFAULT_MODEL_TIER = 'haiku';

+/**
+ * The curator's bounded turn budget.
+ *
+ * ## What `maxTurns` means, verified rather than assumed
+ *
+ * Read out of the installed `@anthropic-ai/claude-agent-sdk@0.3.150`:
+ *
+ *  - `Options.maxTurns` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1527-1530`):
+ *    "Maximum number of conversation turns before the query stops. A turn
+ *    consists of a user message and assistant response."
+ *  - `AgentDefinition.maxTurns` (same file, `:73-75`) states the unit outright:
+ *    "Maximum number of agentic turns (API round-trips) before stopping".
+ *  - Exceeding it is a RESULT, not a throw: `SDKResultError.subtype` includes
+ *    `'error_max_turns'` (`:3402`) and `TerminalReason` includes `'max_turns'`
+ *    (`:5687`).
+ *  - `SdkQueryRunner` forwards the number to the CLI as `--max-turns`, so the
+ *    ceiling is enforced by the `claude` binary, not by this process.
+ *
+ * One turn is therefore ONE API round-trip. `maxTurns: 1` — what this used to
+ * be — buys the model exactly one assistant response. It may emit `tool_use`
+ * blocks in it, and the SDK will even run the tools, but delivering the
+ * `tool_result` back needs a SECOND round-trip, and that one never happens.
+ * The model never observes what its own tool call returned and never writes the
+ * JSON that follows from it. The MCP wiring three lines above `maxTurns` was
+ * attached and unreachable (TASK_2026_376 F8).
+ *
+ * ## Why 6
+ *
+ * Two is the floor: call, observe, answer. Six is the floor plus room for a
+ * short chain — search memory, read a file the transcript named, then answer —
+ * which is the shape curation actually has.
+ *
+ * It stays a BOUND, and a small one. `DEFAULT_ONE_SHOT_MAX_TURNS` is 25
+ * (`helpers/sdk-query-runner.service.ts:66`); the curator asks for a quarter of
+ * that because it runs behind a 60-second per-lane queue budget
+ * (`DEFAULT_QUEUE_TIMEOUT_MS`, `internal-query/internal-query.service.ts`) on a
+ * lane whose `perLaneLimit` is 1. Every turn this run spends is a turn the next
+ * curation window waits, and a window that waits past the budget is DROPPED
+ * (TASK_2026_376 F4). A generous ceiling here is not free latency — it is the
+ * next window's data loss. Raise it only with that trade in hand.
+ */
+export const CURATOR_MAX_TURNS = 6;
+
 @injectable()
 export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
   constructor(
@@ -218,6 +277,26 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
         providerId: outcome.providerId,
       };
     }
+    // `tools-only` and `silent` both yield no drafts, and the CONTRACT cannot
+    // tell them apart: `CuratorExtraction` has two arms, and adding a third
+    // means editing `memory-contracts` and `memory-curator`, neither of which
+    // this batch owns (reported in b5-report.md). What is inside reach is the
+    // record — an operator reading the log can now see that the pass ran, used
+    // tools, and chose not to write JSON, which is a different event from a
+    // pass that produced nothing at all.
+    if (outcome.kind === 'tools-only') {
+      this.logger.info(
+        '[memory-curator] curator extract pass did its work through tools and returned no JSON; nothing to persist from this pass',
+        { toolUses: outcome.toolUses, toolNames: outcome.toolNames },
+      );
+      return { status: 'extracted', drafts: [] };
+    }
+    if (outcome.kind === 'silent') {
+      this.logger.warn(
+        '[memory-curator] curator extract pass produced neither text nor tool calls',
+      );
+      return { status: 'extracted', drafts: [] };
+    }
     return { status: 'extracted', drafts: this.parseDrafts(outcome.text) };
   }

@@ -244,6 +323,19 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
     if (outcome.kind === 'cooling-down') {
       return drafts.map((d) => ({ ...d, mergeTargetId: null }));
     }
+    if (outcome.kind === 'tools-only') {
+      this.logger.info(
+        '[memory-curator] curator resolve pass used tools and returned no JSON; storing the drafts unmerged',
+        { toolUses: outcome.toolUses, toolNames: outcome.toolNames },
+      );
+      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
+    }
+    if (outcome.kind === 'silent') {
+      this.logger.warn(
+        '[memory-curator] curator resolve pass produced neither text nor tool calls; storing the drafts unmerged',
+      );
+      return drafts.map((d) => ({ ...d, mergeTargetId: null }));
+    }
     return this.parseResolved(outcome.text, drafts);
   }

@@ -283,7 +375,11 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
         // Was hard-coded false (defect 13). The curator reads and writes memory
         // through Ptah tools when they are reachable.
         ...resolveMcpSessionWiring(this.mcpServerStatus),
-        maxTurns: 1,
+        // Was 1, which made the MCP wiring on the line above unusable: one
+        // round-trip cannot carry a tool_result back to the model. See
+        // CURATOR_MAX_TURNS for the SDK semantics this number is derived from
+        // and for why it stays small.
+        maxTurns: CURATOR_MAX_TURNS,
         // The curator's own concurrency lane. Before TASK_2026_352 every
         // internal one-shot shared a single host-wide slot, so a curation pass
         // queued behind an unrelated skill-synthesis lane call and back again
@@ -293,22 +389,52 @@ export class SdkInternalQueryCuratorLlm implements ICuratorLLM {
         auth,
       });
       let collected = '';
+      let toolUses = 0;
+      const toolNames: string[] = [];
+      let hitTurnCeiling = false;
       for await (const msg of handle.stream as AsyncIterable<SDKMessage>) {
         if (msg.type === 'assistant') {
           const message = (
             msg as unknown as {
-              message?: { content?: Array<{ type: string; text?: string }> };
+              message?: {
+                content?: Array<{ type: string; text?: string; name?: string }>;
+              };
             }
           ).message;
           for (const block of message?.content ?? []) {
             if (block.type === 'text' && typeof block.text === 'string') {
               collected += block.text;
             }
+            // The half the old collector dropped. A turn spent on a tool call
+            // contributed NOTHING here, so a run that searched memory and read
+            // three files was reported exactly like a run that said nothing.
+            if (block.type === 'tool_use') {
+              toolUses++;
+              if (typeof block.name === 'string' && block.name.length > 0) {
+                if (!toolNames.includes(block.name)) toolNames.push(block.name);
+              }
+            }
           }
         }
-        if (msg.type === 'result') break;
+        if (msg.type === 'result') {
+          // `error_max_turns` is a RESULT in this SDK, never a throw, so an
+          // exhausted budget is silent unless it is read here. It is the one
+          // signal that says CURATOR_MAX_TURNS is set too low for the work.
+          const subtype = (msg as unknown as { subtype?: string }).subtype;
+          hitTurnCeiling = subtype === 'error_max_turns';
+          break;
+        }
+      }
+      if (hitTurnCeiling) {
+        this.logger.warn(
+          '[memory-curator] curator run stopped at its turn ceiling; the model had more tool work queued than the budget allows',
+          { maxTurns: CURATOR_MAX_TURNS, toolUses, toolNames },
+        );
       }
-      return { kind: 'text', text: collected };
+      if (collected.length > 0)
+        return { kind: 'text', text: collected, toolUses };
+      if (toolUses > 0) return { kind: 'tools-only', toolUses, toolNames };
+      return { kind: 'silent' };
     } catch (error: unknown) {
       const message = error instanceof Error ? error.message : String(error);
       this.logger.warn('[memory-curator] curator LLM query failed', {
```

---

## 7. Tests

Project name read from `libs/backend/agent-sdk/project.json` -> `name` is
`@ptah-extension/agent-sdk`.

Nine specs added, in two new describes.

**`the turn budget (TASK_2026_376 F8)`**

1. `asks for more than one turn, so a tool_result can reach the model` — pins
   `CURATOR_MAX_TURNS >= 2`.
2. `keeps the budget BOUNDED and below the one-shot default of 25` — pins the
   bound, so an unbounded value fails the suite.
3. `sends CURATOR_MAX_TURNS into the internal query, not a hard-coded 1` — pins
   what actually reaches `InternalQueryService.execute`.

**`tool-only runs are not silent runs`**

4. `records a tool-only extract pass DISTINCTLY from a pass that produced
nothing` — runs both and asserts the two log messages differ. This is the
   spec the finding asks for.
5. `names the tools it used, so the pass can be told apart in a log`.
6. `still resolves EXTRACTED (not stalled) after a tool-only pass`.
7. `parses the JSON normally when a run BOTH called tools and answered` — the
   regression guard on the ordinary path.
8. `warns when the run stopped at the turn ceiling`.
9. `stores drafts unmerged after a tool-only RESOLVE pass`.

### Command and real output

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk --skip-nx-cache

 NX   Running target test for project @ptah-extension/agent-sdk:

Test Suites: 1 skipped, 85 passed, 85 of 86 total
Tests:       2 skipped, 1414 passed, 1416 total

 NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

One project in the header, as required. Nx prints the singular form
`for project @ptah-extension/agent-sdk` when N is 1; the plural `for N projects`
form appears only for a multi-project set.

The curator spec alone, to show the new specs really ran rather than being
filtered away:

```
$ npx jest --config libs/backend/agent-sdk/jest.config.ts --runTestsByPath \
    libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts

Test Suites: 1 passed, 1 total
Tests:       34 passed, 34 total
```

34 = the 25 that were there plus the 9 added. No test failed.

### Lint and format

```
$ npx nx run-many -t lint -p @ptah-extension/agent-sdk
✖ 38 problems (0 errors, 38 warnings)
 NX   Successfully ran target lint for project @ptah-extension/agent-sdk
```

Zero errors. Every warning is pre-existing and in files this batch did not touch
(`no-non-null-assertion` in existing specs, `max-lines` on
`sdk-permission-handler.ts`). `prettier --write` was run on the changed files and
the suite was re-run afterwards, clean.

---

## 8. Left for someone else

1. **The contract arm.** `CuratorExtraction` cannot express "ran, used tools,
   wrote no JSON". Adding it means editing `memory-contracts` and
   `memory-curator`. Both are outside this boundary. Until then the distinction
   lives in the log only.
2. **F6 interaction.** `buildOneShotHooks` still wires the compaction handler on
   every one-shot query. With `maxTurns` now 6 instead of 1, a curator run is no
   longer categorically unable to reach a compaction boundary — it is only very
   unlikely to. F6's reasoning ("`maxTurns` is 1, so it cannot compact") is
   weakened by this batch. Whoever picks up F6 should re-read it against 6
   rather than 1.
