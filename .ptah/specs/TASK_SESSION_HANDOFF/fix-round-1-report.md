# Session hand-over — fix round 1

## Fixed

1. **Owned `/compact` admission deadlock:** added the `owned-compact` envelope admission and bypassed normal handover admission when the pump dequeues it. The coordinator's owned compact therefore runs while the operation is compacting, while only held user inputs remain transferable/restorable. The pump regression test drives a real coordinator through `enqueueOwnedCompact`. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:96`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:290`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts:187`.
2. **History reader DI token:** coordinator injection now uses `SDK_TOKENS.SDK_SESSION_HISTORY_READER`, matching its registration. `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:123`.
3. **Budget DI token and cycle:** lifecycle injection now uses `SDK_TOKENS.SDK_SESSION_BUDGET`. The registration uses an `instanceCachingFactory` with a lazy lifecycle control facade, so the budget-to-lifecycle callback does not construct a circular graph. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:417`, `libs/backend/agent-sdk/src/lib/di/register.ts:772`.
4. **DI integration coverage:** extended the agent-SDK registration smoke spec to construct the real coordinator and lifecycle manager from `registerSdkServices`, with minimal unrelated platform/query stubs. It asserts non-null history reader, builder, writer, and budget service; it fails with either old class-token injection. `libs/backend/agent-sdk/src/lib/di/register.compaction-boundary-registry.smoke.spec.ts:354`.
5. **Durable compact-boundary wait:** replaced immediate-tick retrying with a named 120-second wall-clock limit and 500 ms poll interval. The wait returns early when the owned compact is neither queued nor in flight; the fake-timer spec covers the durable boundary wait. `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:79`, `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:187`, `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts:2043`.
6. **Review A — durable seed preservation:** agent handoff text is capped to the residual seed capacity and prepended, so it cannot truncate the existing durable seed. `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:633`.
7. **Review A — stale close handling:** a token mismatch transitions the operation to `failed`, rather than `closed`, and does not restore/transmit the coordinator-owned compact. `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:374`.
8. **Review A — successor-host availability:** coordinator registration now has a lazy host resolver, so late host registration is checked at handover start rather than captured during coordinator construction. `libs/backend/agent-sdk/src/lib/di/register.ts:748`.
9. **Review A — stranded source snapshot:** source snapshot capture is within the coordinator's guarded completion path, so failures become a published failed operation rather than an unhandled background rejection. `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:312`.
10. **Review A — duplicate blocking predicate:** lifecycle owns the blocking-limit decision at terminal turn processing; the SDK adapter delegates without maintaining a second predicate. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:500`, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1739`.
11. **Batch B Jest load failure:** copied the established workspace-intelligence barrel mock into the handover session spec before its service import. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.spec.ts:7`.
12. **Batch B successor timeout cleanup:** cleanup now ends the successor session (which tears down its tab/session lifecycle) instead of merely interrupting it. The host adapter timeout spec verifies cleanup receives the started successor ID. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:801`, `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts:177`.

## Not fixed

- Review A finding 11 (the batch-D CLI session-spawner/registry concerns) was intentionally not changed: the requested scope explicitly excludes those files.

## Tests

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff libs/backend/agent-sdk/src/lib/helpers/session-lifecycle libs/backend/agent-sdk/src/lib/helpers/session-budget libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts libs/backend/agent-sdk/src/lib/di/register.compaction-boundary-registry.smoke.spec.ts --coverage=false --maxWorkers=2` — **21 suites, 689 tests passed**.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts libs/backend/rpc-handlers/src/lib/chat/session --coverage=false --maxWorkers=2` — **19 suites, 245 tests passed**.
- `npx nx typecheck agent-sdk --parallel=1` — passed.
- `npx nx typecheck rpc-handlers --parallel=1` — passed.
- Scoped TypeScript diagnostics over the changed files — **0 errors, 0 warnings**.

The typecheck commands reported the repository's disabled Nx Cloud organization after completing successfully; both commands exited with status 0.
