# Code Style Review — `TASK_2026_627` (Phase 1)

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 7/10           |
| Assessment      | APPROVED (with follow-ups) |
| Blocking issues | 0              |
| Serious issues  | 0              |
| Moderate issues | 2              |
| Minor issues    | 4              |
| Files reviewed  | 12 non-spec source files of the diff (specs skimmed only) |

Scope limit: the diff tool output was partly condensed, so the middle of `session-handover-coordinator.service.ts`, `session-budget.service.ts`, `session-handoff-builder.ts` and `session-query-executor.service.ts` was read via targeted greps, not line by line. No tests, typecheck or lint were run, as instructed.

## Five style questions

1. What breaks in six months? `SessionHandoverCoordinator.setLaneWorkProvider` keeps one provider in one slot (`session-handover-coordinator.service.ts:171,204-207`). A second lane source would silently replace the first. The release function guards with identity (`:207`), so unregistering is safe, but only one provider is supported. It is fine today because `AgentProcessManager` is the only one.
2. What would a newcomer misread? `PostToolUseHookHandler` declares `@inject(MainThreadNoticeQueue) private readonly noticeQueue?` (`post-tool-use-hook-handler.ts:68-70`). The `?` and the comment "Absent in callers that construct the handler without one" suggest the queue is optional in DI, but it is always resolved. `AgentProcessManager` does the opposite and uses `{ isOptional: true }` (`agent-process-manager.service.ts:~342`). Two different "optional" idioms are used for the same idea.
3. Maintenance cost: the `waitingFor` count is derived in three places, `lifecycle.subagentsInFlight`, `AgentProcessManager.countRunningLanes` and the coordinator `workInFlight`. Each pair of parent ids (SDK id and tab id) is handled by hand: `session-lifecycle-manager.ts:~548-566` and `agent-process-manager.service.ts:~360-375`. A new parent-id alias would have to be added in both.
4. Inconsistency: see Moderate 1 and 2 below.
5. What I would do differently: expose the lane count as an `I`-prefixed port under a Symbol.for token in `SDK_TOKENS`, with the coordinator injecting it via `isOptional`. That would replace the imperative `setLaneWorkProvider` and its release closure, and the reverse dependency from cli-agent-runtime on a concrete coordinator would disappear. The setter approach is acceptable because it avoids a DI cycle, which the comments say is the reason.

## Blocking issues

None.

## Serious issues

None.

## Moderate issues

### 1. cli-agent-runtime depends on the concrete `SessionHandoverCoordinator` class

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:41-44, ~340-350`
- Problem: the import goes through the `@ptah-extension/agent-sdk` barrel (`agent-sdk/src/index.ts:356` exports it). The dependency direction is already established (`claudeModelFamily` came from the same barrel before this diff). Both libs are `scope:extension`/`type:feature`-style tags, so the boundary is allowed. The deviation is that the manager takes a concrete class where the repository normally injects a Symbol.for token or a port for cross-lib collaborators. The manager also now drives registration and unregistration as a side effect of its constructor (`:~350-354`), with release in `disposeAll` (`:~2007`).
- Tradeoff: a narrow `ILaneWorkRegistry`-style port, or a token, would let the manager be constructed in tests with a trivial fake. Today the spec has to build or mock a full coordinator.
- Recommendation: acceptable for Phase 1. Consider narrowing the injected type to `Pick<SessionHandoverCoordinator, 'setLaneWorkProvider'>`. That is cheap and matches the `Pick<MainThreadNoticeQueue, 'clear'>` approach already used in `session-budget.service.ts:95`.

### 2. Constructor-side-effect registration with an optional parameter default

- File: `agent-process-manager.service.ts:~341-354`
- Problem: `handoverCoordinator` is a non-property constructor parameter that is the last positional argument with a `= null` default and `isOptional: true`. Siblings keep injected collaborators as `private readonly` fields. The coordinator then lives only as a closure. Registering in the constructor means every test-constructed manager that passes a coordinator mutates shared state. This is mitigated by the release function in `disposeAll`.
- Recommendation: if the port is introduced (Moderate 1), register from the DI wiring in `cli-agent-runtime/src/lib/di/register.ts`. That is where the other lifecycle hookups live.

## Minor issues

- `session-handover-coordinator.service.ts:186,468,768`: `logger: Logger | null = null` with `this.logger?.` everywhere is a different style from the other helpers, which require `TOKENS.LOGGER`. That is mostly historical (positional constructor from a factory in `register.ts:773`). `publish()` now logs every state change at INFO (`:768`). Most siblings log at DEBUG for per-event traces, so this will be noisy in long-lived sessions.
- `post-tool-use-hook-handler.ts:68-70`: the `?` on an always-resolved `@inject` parameter is misleading (see question 2).
- `main-thread-notice-queue.ts:18`: imports `Logger, TOKENS` from `@ptah-extension/vscode-core`. This matches the existing agent-sdk helpers, so it is not a new violation, but the class uses a class token while the other `register.ts` entries (`SDK_TOKENS.*`) use Symbol.for tokens. `SessionRotationAdvisor` is registered the same way, so the repository is mixed.
- `shared/session-budget.types.ts:319`: the doc comment changed 8,200 to 14,200. Check that the constant it describes lives in one place and is not duplicated in the builder.

## File-by-file

### main-thread-notice-queue.ts
Score 8/10 — 0 B, 0 S, 0 M. Single responsibility, bounded and timer-free, with a release path (`take`/`clear` delete the map entry, `:76,82`). Explicit return types throughout. The surrogate-pair cap (`:30-38`) is a careful touch. It is not exported through the barrel, which is right because it is internal.

### post-tool-use-hook-handler.ts
Score 7/10 — 0 B, 0 S, 0 M, 1 minor. `takeMainThreadNotice` is a small, isolated private method with a failure path that never breaks the hook (`:79-103`). The `agent_id` guard keeps subagent results from draining the queue. The optional `?` idiom is the only issue.

### session-handover-coordinator.service.ts
Score 7/10 — 0 B, 0 S, 0 M, 1 minor. `WaitingFor` derived from the shared type (`:92`) avoids a duplicate shape. `setLaneWorkProvider` returns a release function that is identity-guarded (`:204-207`). The fail-open behaviour on a provider throw is documented. `source-unavailable` is checked before an operation exists (`~:231-234`), as the contract says. INFO log per publish is the only drift.

### session-lifecycle-manager.ts
Score 7/10 — 0 B, 0 S, 0 M, 0 minor. `subagentsInFlight` de-duplicates across id aliases using a `Set` (`~:548-566`). `armHandoverIfIdle` mirrors `onTurnTerminal` arguments, which is clear. Required runtime member `subagentsInFlight` is wired in the one construction site (`:502-503`).

### di/register.ts
Score 8/10 — 0 B, 0 S, 0 M, 0 minor. `container.registerSingleton(MainThreadNoticeQueue)` is placed before the hook handler (`:279`). The monitor factory (`:501`) and `SessionBudgetService` factory (`:830`) both resolve the same singleton. The comment explains the ordering. Matches how `SessionRotationAdvisor` is wired.

### agent-process-manager.service.ts
Score 6/10 — see Moderate 1 and 2. `countRunningLanes` is a clear, linear scan with a documented status assumption.

### shared types (session-handover.types.ts, session-budget.types.ts)
Score 8/10. `waitingFor` is optional and readonly. `BeginSessionHandoverResult` widens its `error` union to include `'source-unavailable'`, which is additive. Any exhaustive `switch` over the error in rpc-handlers/webview should be confirmed (not checked here; `session-handover-rpc.handlers.ts` and `chat-session.service.ts` consume it).

### subagent-budget-monitor.ts, session-budget.service.ts, session-handoff-builder.ts, session-query-executor.service.ts
Score 7/10 each, with partial reading. Consistent use of `import type`, explicit return types, the Logger and no `console`. `session-budget.service.ts:95` narrows the queue with `Pick<>`, which is the better pattern and the one I would use elsewhere.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Import other libs only via `@ptah-extension/*` barrel | PASS | `agent-process-manager.service.ts:41-44` |
| cli-agent-runtime may depend on agent-sdk (tags) | PASS | pre-existing `claudeModelFamily` import from the same barrel |
| No new vscode-core imports into agnostic libs | PASS | the queue sits in agent-sdk, which already imports vscode-core (`main-thread-notice-queue.ts:18`) |
| DI registration of new singleton | PASS | `register.ts:279` |
| Cross-lib collaborators via Symbol.for token / `I`-prefixed port | PARTIAL / FAIL | concrete class injected, `agent-process-manager.service.ts:~340`; queue uses a class token (`post-tool-use-hook-handler.ts:68`) |
| Logger, not console | PASS | no `console` in the new source |
| Explicit return types | PASS | all new methods viewed |
| No new `as any` | PASS | none seen in the non-spec diff |
| `import type` for type-only imports | PASS | seen in monitor and register |
| Timers, listeners and observers have a release path | PASS | queue has none; provider release at `agent-process-manager.service.ts:~2007` |
| Log level discipline | FAIL (minor) | INFO per publish, `session-handover-coordinator.service.ts:768` |

## Maintenance debt

- Introduced: one internal queue class, one provider slot, three separate "work in flight" counters keyed on id aliases, and a concrete-class reverse dependency from cli-agent-runtime.
- Retired: the earlier direct injection of the subagent handoff into the parent input stream (replaced by the notice queue).
- Net: roughly neutral. Clean new code, with a small amount of coupling added.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (middle sections of four files were read through grep and targeted reads, not line by line)
- Key concern: `AgentProcessManager` depends on the concrete `SessionHandoverCoordinator` and registers in its own constructor, where a narrow port or `Pick<>` type would match the repository's own pattern.
- What a 10/10 version would do differently: inject a `Pick`/port instead of the concrete class; register the lane provider from `cli-agent-runtime`'s DI wiring; drop the `?` on always-resolved injections; log publishes at DEBUG; add a single helper for the SDK id and tab id alias set shared by the subagent and lane counters.
