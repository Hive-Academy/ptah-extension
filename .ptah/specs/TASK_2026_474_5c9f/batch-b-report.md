# Batch B Report — Empty Result Stats

## Producer finding

The zero payload is produced by a legitimate SDK result message for a queued task-notification turn, not by corrupt SDK data.

- The resume path selects the idle prompt stream at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:315` and connects queued user input with `sdkQuery.streamInput(userMessageStream)` at line 340.
- `SessionStreamPump` marks each dequeued message as a turn at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:81`. The persisted session JSONL shows a task-notification dequeued at the same timestamp as the empty result, followed by the actual human continuation message.
- The adapter installs `releaseTurnOnResult(sessionId)` at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:893`; the release callback is defined at line 1276.
- The `result` branch calls `onTurnEnd` first at `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:436-438`, then previously constructed and emitted stats unconditionally. The task-notification result carries zero aggregate tokens and no `modelUsage`, so that unconditional emission created the observed `{cost:0,tokens:0,duration:63}` header update.

This result is a meaningful turn boundary but contains no usage information. Its result event must continue through the transformer, and its turn claim must be released, but it is not a stats update.

## Fix choice

I chose producer-side suppression: `StreamTransformer` does not call `onResultStats` when all four aggregate token counters are exactly zero and the filtered per-model usage list is empty. The result still reaches the message transformer, and `onTurnEnd` remains before the stats logic and therefore releases the turn claim unconditionally.

Consumer-side preservation is wrong here because the producer already has the authoritative distinction between a result with usage and a result with none. A consumer guard would duplicate that inference in every subscriber and would still expose a false zero stats payload for a brand-new session.

The test guard uses exact zero comparisons rather than truthiness. Negative, `NaN`, and infinite values therefore still reach `validateStats` and retain the existing corruption warnings/rejection behavior.

## `tokens` versus `modelUsage`

When every top-level token counter is zero but `modelUsage` is populated, the emitted token totals are now derived by summing the cumulative per-model input, output, and cache-read figures. Cache creation remains zero because `ResultModelUsage` does not expose that counter. This fallback is limited to the completely empty aggregate shape, so a normal nonzero aggregate payload remains authoritative and unchanged.

This is appropriate for the measured line-67 payload: `modelUsage` is cumulative per session and contains the only real usage (`273539` input and `8847` output), while presenting the empty aggregate as the session total is demonstrably false.

## Tests added

In `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts`:

- `does not replace populated header stats with a result that has no usage or modelUsage`
- `keeps the populated stats from the real resume sequence after skipping the zero result`
- `releases the turn claim even when the no-usage stats emission is skipped`
- `leaves a new session header empty when its result has no usage`
- `derives the measured cumulative token totals from modelUsage when aggregate usage is empty`

## Full Batch B diff

```diff
diff -- libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts
@@
-                const rawStats = {
-                  sessionId: effectiveSessionId,
-                  cost: totalCost,
-                  tokens: {
-                    input: sdkMessage.usage.input_tokens,
-                    output: sdkMessage.usage.output_tokens,
-                    cacheRead: sdkMessage.usage.cache_read_input_tokens ?? 0,
-                    cacheCreation:
-                      sdkMessage.usage.cache_creation_input_tokens ?? 0,
-                  },
-                  duration: sdkMessage.duration_ms,
-                  modelUsage:
-                    modelUsageList.length > 0 ? modelUsageList : undefined,
-                };
-                const validatedStats = validateStats(rawStats, logger);
-                if (validatedStats) {
-                  onResultStats(validatedStats);
+                const sdkTokens = {
+                  input: sdkMessage.usage.input_tokens,
+                  output: sdkMessage.usage.output_tokens,
+                  cacheRead: sdkMessage.usage.cache_read_input_tokens ?? 0,
+                  cacheCreation:
+                    sdkMessage.usage.cache_creation_input_tokens ?? 0,
+                };
+                const hasNoSdkTokenUsage =
+                  sdkTokens.input === 0 &&
+                  sdkTokens.output === 0 &&
+                  sdkTokens.cacheRead === 0 &&
+                  sdkTokens.cacheCreation === 0;
+
+                // A result with neither aggregate usage nor per-model usage is
+                // a turn boundary, not a stats update. Emitting its zero values
+                // would overwrite the populated session header after resume.
+                if (!hasNoSdkTokenUsage || modelUsageList.length > 0) {
+                  const tokens = hasNoSdkTokenUsage
+                    ? modelUsageList.reduce<MessageTokenUsage>(
+                        (total, usage) => ({
+                          input: total.input + usage.inputTokens,
+                          output: total.output + usage.outputTokens,
+                          cacheRead:
+                            (total.cacheRead ?? 0) +
+                            usage.cacheReadInputTokens,
+                          cacheCreation: total.cacheCreation ?? 0,
+                        }),
+                        {
+                          input: 0,
+                          output: 0,
+                          cacheRead: 0,
+                          cacheCreation: 0,
+                        },
+                      )
+                    : sdkTokens;
+                  const rawStats = {
+                    sessionId: effectiveSessionId,
+                    cost: totalCost,
+                    tokens,
+                    duration: sdkMessage.duration_ms,
+                    modelUsage:
+                      modelUsageList.length > 0 ? modelUsageList : undefined,
+                  };
+                  const validatedStats = validateStats(rawStats, logger);
+                  if (validatedStats) {
+                    onResultStats(validatedStats);
+                  }
                 }

diff -- libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts
@@
 function resultMessageMulti(opts: {
@@
   } as unknown as SDKMessage;
 }
+
+function rawResultMessage(opts: {
+  totalCostUsd: number;
+  durationMs: number;
+  usage: {
+    inputTokens: number;
+    outputTokens: number;
+    cacheReadInputTokens: number;
+    cacheCreationInputTokens: number;
+  };
+  modelUsage?: Record<string, ResultModelUsageFixture>;
+}): SDKMessage {
+  const modelUsage = opts.modelUsage
+    ? Object.fromEntries(
+        Object.entries(opts.modelUsage).map(([model, usage]) => [
+          model,
+          {
+            ...usage,
+            cacheReadInputTokens: 0,
+            cacheCreationInputTokens: 0,
+            contextWindow: 200000,
+          },
+        ]),
+      )
+    : undefined;
+
+  return {
+    type: 'result',
+    subtype: 'success',
+    session_id: 'sess-1',
+    duration_ms: opts.durationMs,
+    duration_api_ms: opts.durationMs,
+    is_error: false,
+    num_turns: 1,
+    total_cost_usd: opts.totalCostUsd,
+    usage: {
+      input_tokens: opts.usage.inputTokens,
+      output_tokens: opts.usage.outputTokens,
+      cache_read_input_tokens: opts.usage.cacheReadInputTokens,
+      cache_creation_input_tokens: opts.usage.cacheCreationInputTokens,
+    },
+    ...(modelUsage ? { modelUsage } : {}),
+  } as unknown as SDKMessage;
+}
@@
 describe('StreamTransformer — result stats validation', () => {
@@
   });
 });
+
+describe('StreamTransformer — usage-less result stats', () => {
+  const noUsageResult = (): SDKMessage =>
+    rawResultMessage({
+      totalCostUsd: 0,
+      durationMs: 63,
+      usage: {
+        inputTokens: 0,
+        outputTokens: 0,
+        cacheReadInputTokens: 0,
+        cacheCreationInputTokens: 0,
+      },
+    });
+
+  it('does not replace populated header stats with a result that has no usage or modelUsage', async () => {
+    const { transformer } = makeHarness();
+    const populatedHeader = {
+      cost: 1.1098535,
+      tokens: { input: 18, output: 7611 },
+    };
+    let header: unknown = populatedHeader;
+
+    await drain(
+      transformer.transform({
+        sdkQuery: asAsyncIterable([noUsageResult()]),
+        sessionId: 'sess-1' as SessionId,
+        initialModel: MODEL,
+        onResultStats: (stats) => {
+          header = stats;
+        },
+      }),
+    );
+
+    expect(header).toBe(populatedHeader);
+  });
+
+  it('keeps the populated stats from the real resume sequence after skipping the zero result', async () => {
+    const { transformer } = makeHarness();
+    const onResultStats = jest.fn();
+    const populatedResult = rawResultMessage({
+      totalCostUsd: 1.1098535,
+      durationMs: 95_000,
+      usage: {
+        inputTokens: 18,
+        outputTokens: 7611,
+        cacheReadInputTokens: 1_276_637,
+        cacheCreationInputTokens: 28_117,
+      },
+      modelUsage: {
+        'claude-opus-5[1m]': {
+          inputTokens: 1_304_772,
+          outputTokens: 7611,
+          costUSD: 1.1098535,
+        },
+      },
+    });
+
+    await drain(
+      transformer.transform({
+        sdkQuery: asAsyncIterable([noUsageResult(), populatedResult]),
+        sessionId: 'sess-1' as SessionId,
+        initialModel: 'claude-opus-5[1m]',
+        onResultStats,
+      }),
+    );
+
+    expect(onResultStats).toHaveBeenCalledTimes(1);
+    expect(onResultStats).toHaveBeenCalledWith(
+      expect.objectContaining({
+        cost: 1.1098535,
+        tokens: {
+          input: 18,
+          output: 7611,
+          cacheRead: 1_276_637,
+          cacheCreation: 28_117,
+        },
+      }),
+    );
+  });
+
+  it('releases the turn claim even when the no-usage stats emission is skipped', async () => {
+    const { transformer } = makeHarness();
+    const onResultStats = jest.fn();
+    const releaseTurnClaim = jest.fn();
+
+    await drain(
+      transformer.transform({
+        sdkQuery: asAsyncIterable([noUsageResult()]),
+        sessionId: 'sess-1' as SessionId,
+        initialModel: MODEL,
+        onResultStats,
+        onTurnEnd: releaseTurnClaim,
+      }),
+    );
+
+    expect(releaseTurnClaim).toHaveBeenCalledTimes(1);
+    expect(onResultStats).not.toHaveBeenCalled();
+  });
+
+  it('leaves a new session header empty when its result has no usage', async () => {
+    const { transformer } = makeHarness();
+    let header: unknown;
+
+    await drain(
+      transformer.transform({
+        sdkQuery: asAsyncIterable([noUsageResult()]),
+        sessionId: 'sess-1' as SessionId,
+        initialModel: MODEL,
+        onResultStats: (stats) => {
+          header = stats;
+        },
+      }),
+    );
+
+    expect(header).toBeUndefined();
+  });
+
+  it('derives the measured cumulative token totals from modelUsage when aggregate usage is empty', async () => {
+    const { transformer } = makeHarness();
+    const onResultStats = jest.fn();
+
+    await drain(
+      transformer.transform({
+        sdkQuery: asAsyncIterable([
+          rawResultMessage({
+            totalCostUsd: 1.77963875,
+            durationMs: 103_763,
+            usage: {
+              inputTokens: 0,
+              outputTokens: 0,
+              cacheReadInputTokens: 0,
+              cacheCreationInputTokens: 0,
+            },
+            modelUsage: {
+              'claude-opus-5[1m]': {
+                inputTokens: 273_539,
+                outputTokens: 8847,
+                costUSD: 1.77963875,
+              },
+            },
+          }),
+        ]),
+        sessionId: 'sess-1' as SessionId,
+        initialModel: 'claude-opus-5[1m]',
+        onResultStats,
+      }),
+    );
+
+    expect(onResultStats).toHaveBeenCalledWith(
+      expect.objectContaining({
+        tokens: {
+          input: 273_539,
+          output: 8847,
+          cacheRead: 0,
+          cacheCreation: 0,
+        },
+      }),
+    );
+  });
+});
```

## Verification

All three commands targeted one project, and each Nx header confirms the singular `project @ptah-extension/agent-sdk`.

### `npx nx run-many -t test -p @ptah-extension/agent-sdk`

```text
 NX   Running target test for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk



> nx run @ptah-extension/agent-sdk:test

(node:10492) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:10492) Warning: Failed to load the ES module: D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(node:23072) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26696) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26892) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34488) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31104) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28056) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:29984) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26784) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28008) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:2544) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:21828) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13308) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:16344) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33276) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22548) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 2 skipped, 111 passed, 111 of 113 total
Tests:       3 skipped, 2006 passed, 2009 total
Snapshots:   0 total
Time:        27.255 s, estimated 76 s
Ran all test suites.



 NX   Successfully ran target test for project @ptah-extension/agent-sdk


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk`

```text
 NX   Running target typecheck for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk



> nx run @ptah-extension/agent-sdk:typecheck

> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json




 NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### `npx nx run-many -t lint -p @ptah-extension/agent-sdk`

```text
 NX   Running target lint for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk



> nx run @ptah-extension/agent-sdk:lint

(node:13824) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/agent-sdk"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\sdk-model-service.ts
  802:47  warning  Unexpected empty async generator function  @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts
  1287:1  warning  File has too many lines (949). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.spec.ts
   919:21  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
   920:21  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
   921:21  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
   988:13  warning  'rec' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1117:14  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
  1123:14  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
  1123:37  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.spec.ts
  456:9  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\permission\ask-user-question.service.spec.ts
  131:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  165:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  193:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  237:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  238:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  341:11  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  400:31  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  496:11  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\permission\exit-plan-mode.service.spec.ts
   99:18  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  125:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
  990:1  warning  File has too many lines (913). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\sdk-permission-handler.spec.ts
   128:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   163:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   193:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   235:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   236:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   271:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   272:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   315:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   381:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   416:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   445:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   893:8   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   987:9   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1227:7   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1258:9   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1306:9   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1420:13  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
  895:1  warning  File has too many lines (896). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
  951:1  warning  File has too many lines (883). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\session-metadata-store.ts
  1036:1  warning  File has too many lines (885). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\session-stats\session-stats-reader.perf.spec.ts
  223:9  warning  Unused eslint-disable directive (no problems were reported from 'no-console')

✖ 42 problems (0 errors, 42 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.

✖ 42 problems (0 errors, 42 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.




 NX   Successfully ran target lint for project @ptah-extension/agent-sdk


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```
