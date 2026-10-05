# Code Style Review — TASK_2026_614 Stage D + E (new public API)

Score 7.5/10 — NEEDS_REVISION is not warranted; verdict APPROVED with moderate/minor findings. 0 blocking, 0 serious, 2 moderate, 4 minor.

Scope: diff hunks listed in the request plus call sites. Not covered: session-query-executor internals beyond the `onMessage`/`onStreamEnd` threading, spec files, the stdio server `dispose` hunk.

## Boundary / lattice checks

- `wait-tools-args.schema.ts` imports `MAX_AGENT_WAIT_MS` from `@ptah-extension/cli-agent-runtime` through its barrel (`cli-agents/index.ts:17`). vscode-lm-tools already imports that lib (agent-wait.tool.ts, protocol-dispatcher.ts). PASS, and it removes a drifting duplicate constant.
- `apps/*` import `killRunningChecks` through the `@ptah-extension/vscode-lm-tools` barrel (`index.ts:21`). PASS. No new vscode-core imports in agnostic libs seen.
- `import type` for `Query`/`SDKUserMessage`/`SessionLifecycleManager` in subagent-message-dispatcher.ts. PASS.
- Angular `SessionRotationKeepService`: `providedIn: 'root'`, signals, `asReadonly`, injected with `inject()` (banner:198), immutable set updates. PASS.
- DI: factory registration in `di/register.ts` uses `instanceCachingFactory` and `SDK_TOKENS` Symbol tokens like its siblings; the lazy `dispatcher()` closure is documented. PASS.

## Moderate

1. Inconsistent shutdown handling of `killRunningChecks` across hosts.
   - `apps/ptah-electron/src/activation/shutdown.ts:194-198` fires `void killRunningChecks()` (not awaited), inside a sync `disposeBeforePersistence`. `apps/ptah-extension-vscode/src/main.ts:160-170` awaits it with a try/catch around a function documented as "never rejects".
   - Impact: the same API is consumed with two contracts. On Electron the tree kills may still be in flight when persistence/app quit proceeds, so the "kill the tree before the host dies" guarantee is weaker than in VS Code. The redundant try/catch in main.ts contradicts the "never rejects" doc.
   - Fix: pick one: await in Electron if the surrounding dispose can be async, or document why fire-and-forget is acceptable; drop the redundant catch (or drop the "never throws" claim).

2. `SubagentStopPort` is now misnamed (`subagent-budget-monitor.ts:239-242`). It picks `stopSubagent | pushParentMessage`, and the second sends a message to the parent session, not a stop. The name describes one mechanism of an enlarged port. Rename to e.g. `SubagentBudgetDispatcherPort` (domain name). Cost: next reader will look for stop-only semantics.

## Minor

- `PreparedSdkHandleSpawn` and `GatedResume` are exported from `agent-process-manager.service.ts:130-150` but not re-exported from `cli-agents/index.ts`/package index, while they are the return type of the public `prepareSdkHandleSpawn`. Consumers can infer, but the public signature references an unreachable type. Export them via the barrel (or keep non-exported if no consumer names them).
- `ExecuteQueryResult.onMessage` / `onStreamEnd` (`session-lifecycle-manager.ts:310-318`) are added after `activityWatchdog` with one shared doc block; the second property has no own doc. They also repeat in 3 call sites of `sdk-agent-adapter.ts` (747, 1029, 1380) as pass-through pairs. Duplication is pre-existing for `activityWatchdog`, so it is consistent, but a single `compactionTap: {onMessage, onStreamEnd}` would avoid three more copies. Tolerable; third-use rule already met.
- `StreamTransformer` try/catch blocks for `onMessage` and `onStreamEnd` duplicate the same error-name logging shape (`stream-transformer.ts:439-455`, `918-935`); a tiny helper would remove it. Optional.
- `AgentWaitResult.cancelled` is optional (`?: boolean`) while `timedOut` is required; the doc justifies it, but `waitForAgents` always sets it, so a required field with the construction sites updated would be tighter.
- `getRequestAbortSignal` (mcp-request-context.ts:96) follows the sibling accessor shape and naming. PASS; the `_abortSignal` underscore-private convention leaks into `McpRequest` types (mcp-protocol.types.ts:63) but is transport-owned and documented.

## Five style questions

1. Six months out: the `SubagentStopPort` name and the Electron/VS Code shutdown divergence will mislead. `MAX_WAIT_TIMEOUT_SEC` derived from `MAX_AGENT_WAIT_MS` removes a drift risk.
2. Newcomer misreads: `rekey` merge precedence (existing entries kept unless `from` holds the same one) is documented but subtle (subagent-budget-monitor.ts:349-379). `prepareSdkHandleSpawn` returns a `resumeDecision` only on resume; documented.
3. Maintenance cost: the three-fold adapter pass-through; two near-identical guarded callbacks.
4. Inconsistency: shutdown call styles (above); otherwise wiring follows sibling factories and tokens.
5. Differently: bundle the tap callbacks into one object; use a single dispose contract for `killRunningChecks` in both hosts.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Apps import libs via barrels only | PASS | main.ts:35, shutdown.ts:1 |
| No new vscode-core imports in agnostic libs | PASS | diff hunks |
| Symbol.for tokens / registration file | PASS | di/register.ts:432-482 |
| `import type` for type-only | PASS | subagent-message-dispatcher.ts:34-37 |
| Explicit return types on public APIs | PASS | pushParentMessage, rekey, prepareSdkHandleSpawn, killRunningChecks |
| Angular standalone/root/signals/inject | PASS | session-rotation-keep.service.ts |
| Types reachable from public barrel | FAIL (minor) | PreparedSdkHandleSpawn |
| Consistent host consumption | FAIL (moderate) | shutdown.ts:195 vs main.ts:160 |

## Verdict

APPROVE with revisions requested for the two moderate items. Confidence MEDIUM-HIGH (limited to listed hunks). A 10/10 version would: unify shutdown handling, rename the dispatcher port, export the new public types, and bundle the tap callbacks.
