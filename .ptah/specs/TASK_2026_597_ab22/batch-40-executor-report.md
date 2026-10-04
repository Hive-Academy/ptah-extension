# Batch 40 executor report — TASK_2026_597_ab22 (PR 2)

Executor: backend-developer. Sequential. Not committed. No edit to batches.md.

## Tasks

- 40.1 `lastActivityAt` + `SubagentCacheInfo` + `computeSubagentCacheState` — done
- 40.2 registry stamps activity (injectable clock) — done

## Files

- MODIFIED `libs/shared/src/lib/types/subagent-registry.types.ts` — `SubagentRecord.lastActivityAt?: number` (optional,
  mutable like `interruptedAt`); new `SubagentCacheInfo { cacheState: 'warm' | 'cold'; effectiveTtl: SubagentPromptCacheTtl;
idleMs: number }`. TTL type imported (type-only) from `./rpc/rpc-agents.types` (Batch 37), no repeated literal.
- CREATED `libs/shared/src/lib/utils/subagent-cache-state.ts` — pure `computeSubagentCacheState(lastActivityAt, effectiveTtl, now)`.
- CREATED `libs/shared/src/lib/utils/subagent-cache-state.spec.ts` — missing / NaN -> cold; future -> warm idle 0;
  boundary table for 5m and 1h (TTL-1 warm, TTL exactly cold, TTL+1 cold).
- MODIFIED `libs/shared/src/lib/utils/index.ts` — exports `computeSubagentCacheState` (`SubagentCacheInfo` is exported via
  the existing `export *` of `subagent-registry.types` in `libs/shared/src/index.ts:20`).
- MODIFIED `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts` — constructor takes an optional
  clock `() => number` (default `() => Date.now()`, read per call so `jest.spyOn(Date, 'now')` works); `now()` accessor.
  Pattern: `exec-git.ts:189` (`now: () => number = Date.now`). `set` is unchanged (does not stamp).
- MODIFIED `libs/backend/vscode-core/src/services/subagent-registry.service.ts` — `register` sets
  `lastActivityAt: this.store.now()` (after the spread, so it always wins); `update` stamps right after the record lookup,
  before the completion branch; `SubagentRegistration` now also omits `lastActivityAt`; `restoreResumableBySession`
  doc notes the carried value is kept (the existing `{ ...record }` copy already keeps it). The service constructor is
  unchanged (still only `TOKENS.LOGGER`), so tsyringe wiring is untouched.
- MODIFIED `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.spec.ts` — activity clock tests.
- CREATED `libs/backend/vscode-core/src/services/subagent-registry-activity.spec.ts` — register stamp, override of a
  smuggled value, re-stamp per update, teardown-kept SubagentStop completion is stamped, completed outside teardown is
  removed, unknown id no-op, restore keeps a carried value / leaves unset, history replay leaves unset.

History replay: `subagent-history-registrar.ts:150-160` builds the record without `lastActivityAt`, so replayed records
are cold with no change to that file.

## AS-N2 — which hooks reach `update` during a subagent run

Production callers of `SubagentRegistryService.update` on this branch:

1. SubagentStop hook — `agent-sdk/src/lib/helpers/subagent-hook-handler.ts:382` (`background_completed`) and `:388`
   (`completed`). Normally deletes the record; during teardown on an interrupted record the completion is ignored and the
   record is kept — that is the case where the stamp matters (the kept record carries the time the agent last ran).
2. Background transition — `agent-sdk/src/lib/message-transform/system-message.transformer.ts:460` (task_started /
   task_updated) and `rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:254`
   (`background_agent_started`).
3. CLI-agent marking — `cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1876` (`isCliAgent: true`).

(`session-spawner.service.ts` calls `update` on a different registry, not `SubagentRegistryService`.)

So no per-message or per-tool hook reaches `update` during a foreground run: for a foreground subagent interrupted
without a teardown SubagentStop, `lastActivityAt` stays at its register time. `markAllInterrupted` and `setTaskId` do
not go through `update` and do not stamp (not in the task's list). Batch 41 consumers should know warm/cold is
"since last observed lifecycle event", which under-reports warmth for long foreground runs.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/agent-sdk
@ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/chat
@ptah-extension/chat-streaming @ptah-extension/chat-ui ptah-extension-vscode ptah-electron ptah-cli
ptah-extension-webview` — "Successfully ran targets typecheck, lint for 13 projects" (26 tasks, 0 cache hits).
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/vscode-core --maxWorkers=2` — "Successfully ran
  target test for 2 projects" (0 cache hits). Re-run with static output: vscode-core 914 passed / 914, shared 2500
  passed / 2500.

## Deviations / decisions

- `idleMs` for a missing timestamp: the plan fixes only `cold`. I return `idleMs: 0` (JSON-safe over RPC; Infinity would
  serialise to `null`) and document it on `SubagentCacheInfo.idleMs` as "unknown". A non-finite timestamp is treated as
  missing. Batch 41 should not print "idle 0m" for a cold record without a timestamp.
- Clock injection lives on `SubagentStateStore` (not the `@injectable()` service constructor, where an extra
  function-typed param would be resolved by tsyringe). Service specs drive it with `jest.spyOn(Date, 'now')`.

## Out-of-scope observations

- None touched. Batches 38/39 files not edited.
