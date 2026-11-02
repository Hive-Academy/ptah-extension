> jest --passWithNoTests=true --testPathPatterns="codex-chat-turn-lifecycle|codex-chat-native-contract|codex-session-usage-owner|session-metadata-store|register.codex-runtime" --coverage=false

(node:15336) Warning: Failed to load the ES module: D:\projects\ptah-extension\.claude-worktrees\codex-usage-pricing\libs\backend\agent-sdk\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)
 FAIL   agent-sdk  src/lib/di/register.codex-runtime.spec.ts
  ● Test suite failed to run

    src/lib/di/register.codex-runtime.spec.ts:44:7 - error TS2352: Conversion of type '{ metadata: { save: jest.Mock<Promise<undefined>, [], any>; readUsage: jest.Mock<Promise<{ messageCount: number; }>, [], any>; persistUsage: jest.Mock<Promise<undefined>, [], any>; }; }' to type 'CodexChatAdapterPorts' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
      Type '{ metadata: { save: Mock<Promise<undefined>, [], any>; readUsage: Mock<Promise<{ messageCount: number; }>, [], any>; persistUsage: Mock<Promise<undefined>, [], any>; }; }' is missing the following properties from type 'CodexChatAdapterPorts': logger, platform, info, checkOptions, and 7 more.

    44       { metadata } as CodexChatAdapterPorts);
             ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

 FAIL   agent-sdk  src/lib/session-metadata-store.spec.ts (23.13 s)
  ● Codex metadata identity › preserves resume state and accumulated totals (async=false)

    expect(received).toMatchObject(expected)

    - Expected  - 1
    + Received  + 1

    @@ -1,8 +1,8 @@
      Object {
        "resumableSdkSubagents": Array [],
    -   "totalCost": 7,
    +   "totalCost": null,
        "totalTokens": Object {
          "input": 23,
          "output": 41,
        },
        "workingDirectory": "/work/project/worktree",

      2551 |       });
      2552 |       await store.updateCodexExecution(threadId, () => execution);
    > 2553 |       expect(await store.get(threadId)).toMatchObject({
           |                                         ^
      2554 |         workingDirectory: '/work/project/worktree',
      2555 |         resumableSdkSubagents: [],
      2556 |         totalCost: 7,

      at src/lib/session-metadata-store.spec.ts:2553:41

  ● Codex metadata identity › preserves resume state and accumulated totals (async=true)

    expect(received).toMatchObject(expected)

    - Expected  - 1
    + Received  + 1

    @@ -1,8 +1,8 @@
      Object {
        "resumableSdkSubagents": Array [],
    -   "totalCost": 7,
    +   "totalCost": null,
        "totalTokens": Object {
          "input": 23,
          "output": 41,
        },
        "workingDirectory": "/work/project/worktree",

      2551 |       });
      2552 |       await store.updateCodexExecution(threadId, () => execution);
    > 2553 |       expect(await store.get(threadId)).toMatchObject({
           |                                         ^
      2554 |         workingDirectory: '/work/project/worktree',
      2555 |         resumableSdkSubagents: [],
      2556 |         totalCost: 7,

      at src/lib/session-metadata-store.spec.ts:2553:41

 FAIL   agent-sdk  src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts (11.524 s)
  ● Codex chat turn lifecycle › feeds native usage and model into the session-stats payload

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: ObjectContaining {"modelUsage": [ObjectContaining {"cacheReadInputTokens": 40, "contextCapacity": {"model": "gpt", "providerId": null, "source": "sdk-native", "tokens": 272000}, "contextWindow": 272000, "costUSD": null, "inputTokens": 80, "lastTurnContextTokens": 90, "model": "gpt", "outputTokens": 30}], "sessionId": "11111111-1111-4111-8111-111111111111", "tokens": {"cacheRead": 40, "input": 80, "output": 30}, "turnCost": null}
    Received: {"costBasis": "unknown", "duration": 0, "pricingCoverage": "none", "sessionId": "11111111-1111-4111-8111-111111111111", "sessionStats": {"costBasis": "unknown", "coverage": "partial", "messageCount": 2, "model": null, "pricingCoverage": "none", "scope": "session", "sessionId": "11111111-1111-4111-8111-111111111111", "status": "empty", "tokenCount": 0, "tokens": {"cacheCreation": 0, "cacheRead": 0, "input": 0, "output": 0}, "totalCost": null}, "tokens": {"cacheCreation": undefined, "cacheRead": 40, "input": 80, "output": 30}, "turnCost": null}

    Number of calls: 1

      519 |     await collect(await h.adapter.startChatSession({ tabId }));
      520 |     expect(stats).toHaveBeenCalledTimes(1);
    > 521 |     expect(stats).toHaveBeenCalledWith(
          |                   ^
      522 |       expect.objectContaining({
      523 |         sessionId: id,
      524 |         turnCost: null,

      at Object.<anonymous> (src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:521:19)

  ● Codex chat turn lifecycle › reports an unknown native context window without inventing one

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: ObjectContaining {"modelUsage": [ObjectContaining {"contextCapacity": {"model": "gpt", "providerId": null, "source": "unknown", "tokens": null}, "contextWindow": 0, "costUSD": null, "lastTurnContextTokens": 90, "model": "gpt"}]}
    Received: {"costBasis": "unknown", "duration": 0, "pricingCoverage": "none", "sessionId": "11111111-1111-4111-8111-111111111111", "sessionStats": {"costBasis": "unknown", "coverage": "partial", "messageCount": 2, "model": null, "pricingCoverage": "none", "scope": "session", "sessionId": "11111111-1111-4111-8111-111111111111", "status": "empty", "tokenCount": 0, "tokens": {"cacheCreation": 0, "cacheRead": 0, "input": 0, "output": 0}, "totalCost": null}, "tokens": {"cacheCreation": undefined, "cacheRead": 40, "input": 80, "output": 30}, "turnCost": null}

    Number of calls: 1

      581 |     await collect(await h.adapter.startChatSession({ tabId }));
      582 |     expect(stats).toHaveBeenCalledTimes(1);
    > 583 |     expect(stats).toHaveBeenCalledWith(
          |                   ^
      584 |       expect.objectContaining({
      585 |         modelUsage: [
      586 |           expect.objectContaining({

      at Object.<anonymous> (src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:583:19)


Test Suites: 3 failed, 4 passed, 7 total
Tests:       4 failed, 216 passed, 220 total
