# Legacy Codex account reader initialize budget

## Summary

The legacy default-home reader in `CodexAccountUsageService` armed a 10 second timer for every JSON-RPC request, including `initialize`. Bundled `codex.exe` 0.165.0 needs about 14.5–17.7 seconds to start, so that timer produced `[CodexAccountUsage] App Server account read unavailable` with `stage: initialize` and `errorClass: AppServerError`. `initialize` now uses the single 60 second budget already owned by the core app-server process. `account/read` and the other reads stay on the existing 10 second timer. The reader still talks to its own child; it does not route through the core client.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-app-server-process.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8o-2-report.md`

`codex-app-server-process.spec.ts` was not changed. It asserts the numeric 60 second boundary and does not name the old local constant.

## Change

- Renamed `INITIALIZE_TIMEOUT_MS` to the exported `CODEX_INITIALIZE_TIMEOUT_MS` (`60_000`) in `codex-app-server-process.ts`. The core handshake and its timeout diagnostic both use that one constant.
- Re-exported `CODEX_INITIALIZE_TIMEOUT_MS` from `libs/backend/codex-runtime/src/index.ts`.
- `createRpcClient().request` takes an optional timeout and otherwise keeps `REQUEST_TIMEOUT_MS` (10 seconds). Only the `initialize` call passes `CODEX_INITIALIZE_TIMEOUT_MS`.

## Specs

In `codex-account-usage.service.spec.ts`, using the existing spawner harness and Jest fake timers:

- **accepts an initialize response after fifteen seconds without warning** — a deferred initialize answered at 15 seconds returns `available` and does not warn.
- **keeps a pending initialize alive until the shared initialize budget** — still unsettled at `CODEX_INITIALIZE_TIMEOUT_MS - 1`, then resolves `{ status: 'service-unavailable', providerId: 'openai-codex' }` and warns with `stage: 'initialize'` and `errorClass: 'AppServerError'`.
- **still times out account/read at ten seconds** — an unanswered `account/read` is still pending at 9,999 ms and fails at 10,000 ms with the same `service-unavailable` result and `stage: 'account'`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Export the existing 60,000 ms constant as `CODEX_INITIALIZE_TIMEOUT_MS` | A second number in auth-providers, or one shared constant | Batch 8n-1 already defined this budget for process start-up. The startup log fails inside that window. | Yes. One rename and one re-export. |
| Pass the budget only on the `initialize` request | Raise every legacy read to 60 seconds, or route the reader through the core client | The task keeps `account/read` and the other reads at 10 seconds and forbids a routing change. | Yes. The optional argument defaults to 10 seconds. |
| Leave `codex-app-server-process.spec.ts` unchanged | Update its `60_000` literals to the exported name | That spec never referenced `INITIALIZE_TIMEOUT_MS`. | Yes. |

## Open items

- Tests, builds, lint, and typecheck were not run here, as directed. The coordinating session owns verification.
- `ptah_agent_report` was called once as `ptah_agent_report`. It was rejected: that name is not a connected MCP tool. Tool search only listed the tasks automation server (`total_hidden_tools: 10`). The same summary is in the lane's final message.

## Fix round

Coordinator verify failed one spec: `accepts an initialize response after fifteen seconds without warning` (`codex-account-usage.service.spec.ts`) with `Exceeded timeout of 5000 ms for a test`. The other two new specs passed.

Cause: after `releaseInitialize()`, account/read, rate-limit, and activity replies plus `closeChild` (fake `setTimeout` / `queueMicrotask`) still need the fake clock. `await expect(pending).resolves` never advances it, so the test hits Jest's real 5 second timeout.

Change: production code untouched. That spec now attaches `expect(pending).resolves` first, then `await jest.advanceTimersByTimeAsync(1)`, then awaits the assertion — the same order as the two passing budget specs. Assertions unchanged: no warn at 15 seconds, result `available`, no warn after.

`ptah_agent_report` delivery for this round is recorded in the lane's final message.
