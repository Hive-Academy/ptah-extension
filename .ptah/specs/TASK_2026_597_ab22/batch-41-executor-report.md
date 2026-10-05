# Batch 41 executor report — N2 cache state in context + subagent query

Executor: backend-developer. Not committed (team-leader owns git). Only Batch 41 files touched.

## Tasks completed

- 41.1 Resumable-subagent context carries cache state and guidance.
- 41.2 `chat:subagent-query` returns optional `cacheInfo` per record.

## Files

- MODIFIED `libs/shared/src/lib/types/subagent-registry.types.ts` — `SubagentQueryResult.subagents` is now
  `Array<SubagentRecord & { readonly cacheInfo?: SubagentCacheInfo }>` (optional field; still assignable to
  `SubagentRecord[]`, so `core`'s `claude-rpc.service.ts` compiles unchanged).
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` — injects
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER`; private `withCacheInfo(records)` resolves the effective TTL once per call
  (`resolveSubagentPromptCacheTtl`, setting `agentOrchestration.subagentPromptCacheTtl` + env
  `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `canSpawnSubagents: true`) and maps each record through
  `computeSubagentCacheState(lastActivityAt, effective, Date.now())`. Applied in all three query branches; skips the
  setting read for an empty list. Stays inside the existing try/catch (failure posture unchanged). Schema not touched:
  only params are schema-checked (`SubagentQuerySchema`), the response is not.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts` — injects the
  workspace provider; each agent line ends `- cache: warm|cold (TTL 5m|1h, idle <n> min)`; a record with no
  (finite) `lastActivityAt` prints `idle unknown` instead of `idle 0 min` (batch 40 decision). Adds the guidance line
  verbatim: "Resume a subagent only when its cache is warm. When it is cold, start a fresh subagent with a short
  brief." plus one honest note line on the AS-N2 limitation (idle counts from the last lifecycle event — start, stop,
  move to background — so a long foreground run can show cold while still warm). Instructions are now assembled
  conditionally and numbered: the "Your FIRST action should be to resume …" item appears only when at least one agent
  is warm and its example id is the first WARM agent; a "Do NOT resume the agents marked cache: cold … start a fresh
  subagent of the same type with a short brief" item appears only when one is cold; then order / user-message /
  start-fresh items as before. The prompt therefore never says both "resume first" and "start fresh" for the same
  agent. The injection log line also carries `effectiveTtl` and `cacheStates`. Which agents are listed is unchanged.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.spec.ts` — workspace
  mock + env save/restore; 5 new tests: warm under auto (1h) with resume-first, cold at 10 min under 5m with no resume
  wording, valid env override beats setting, mixed warm/cold resumes only the warm id, history-restored record prints
  `idle unknown` and is not resumed.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.spec.ts` — workspace mock in the harness;
  4 existing record assertions now expect the cold/unknown `cacheInfo`; 3 new tests (warm vs cold at the 5m boundary,
  env TTL wins on the toolCallId branch, no setting read for an empty result).

## Stack observed

tsyringe constructor `@inject` (no registration change needed — both classes are resolved by the container;
precedent `chat-session.service.ts:182`, `chat-history-read.service.ts:42` inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER`);
settings read via `IWorkspaceProvider.getConfiguration('ptah', 'agentOrchestration.<key>', default)` as in
`agent-rpc.handlers.ts:1095` and `sdk-query-options-builder.ts:1164-1172`; Zod only on RPC params.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core
@ptah-extension/chat @ptah-extension/chat-state ptah-extension-vscode ptah-electron ptah-cli ptah-extension-webview`
  — "Successfully ran targets typecheck, lint for 9 projects"; 0 errors, only pre-existing `preserve-caught-error`
  warnings. `npx eslint` on the five changed files: no output (clean).
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core --maxWorkers=2`
  — "Successfully ran target test for 3 projects": shared 2500/2500, core 1138/1138, rpc-handlers 4091 passed + 7
  skipped (138 suites). Batch 38/39 in-progress files caused no failure.

## Deviations / decisions

- Idle minutes use `Math.floor` (not the `Math.round` of the "interrupted N min ago" text) so the printed idle never
  rounds up past the TTL boundary while the state still says warm.
- Effective-TTL resolution is inlined in both consumers (and already in `agent-rpc.handlers.ts`, Batch 38's file):
  a shared helper would need a file outside Batch 41's ownership. Candidate for a later small extraction in
  rpc-handlers if the reviewer wants one.
- The guidance wording lives in a module-private constant; Batch 32 can lift it when it is scheduled.

## Out-of-scope observations

- AS-N2 (from Batch 40) still holds: `markAllInterrupted` does not stamp, so a foreground agent interrupted without a
  teardown SubagentStop measures idle from its start. Stated in the prompt note, not fixed.
