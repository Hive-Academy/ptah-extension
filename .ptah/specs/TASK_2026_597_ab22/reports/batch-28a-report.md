## Backend implementation — `TASK_2026_597`, batch 28a

**Tasks completed**: Task 28.1 (`SubagentBudgetMonitor`), addendum Component 10.1 (per-subagent `contextTokens` / `weightedUsed`, weighted safety stop), Component 10.2 (pure advice function `adviseSubagentResume`). No wiring (28b).

**Files** (all new):

- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`: `@injectable()` monitor, the pure helpers `readSubagentRequestUsage`, `requestContextTokens`, `weightedRequestTokens` and `adviseSubagentResume`, plus the types `SubagentBudgetSnapshot` and `SubagentResumeAdvice(Input)`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts`: 16 tests.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-597-s4/libs/backend/agent-sdk/src/lib/helpers/compaction/__fixtures__/as10-subagent-assistant-usage.jsonl`: one line built from a real `~/.claude/projects/**/subagents/agent-*.jsonl` assistant line. Only `type`, `isSidechain`, `message.{type, role, content: [], stop_reason, usage{input/cache_creation/cache_read/output tokens, cache_creation{5m,1h}, service_tier}}` are kept. All text, ids, uuids, paths, cwd, model and branch were stripped.

**Contract for 28b (wiring)**

- Constructor (every parameter is `@inject`ed and every token is already registered): `TOKENS.LOGGER`, `SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER`, `SDK_TOKENS.SDK_SUBAGENT_MESSAGE_DISPATCHER`, `TOKENS.SUBAGENT_REGISTRY_SERVICE`, `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER`. `useClass` with a singleton works.
- `observe(sessionId, message: unknown, cacheTtl: SubagentPromptCacheTtl = '5m'): Promise<void>`. It never rejects; the executor can `void` it. It counts only `type === 'assistant'` messages that have a string `parent_tool_use_id` (the Task toolCallId, which is the registry key). `cacheTtl` is the session's effective TTL (`resolveSubagentPromptCacheTtl(...).effective`). It is used only when a message has no `usage.cache_creation` split, and real SDK messages do carry that split.
- `getSnapshot(sessionId, toolCallId)` returns `{contextTokens, weightedUsed, stopped, budgetReached}` or `undefined`. It feeds 28c (F11) and 28d (advice input together with `computeSubagentCacheState`).
- `release(sessionId)` is for session end.

**Behaviour**

- `contextTokens` is the last request's input + cache_read + cache_creation.
- `weightedUsed` is the sum of input×1 + cache read×0.1 + output×5 + cache write×1.25 (5m) / ×2 (1h). The SDK sends one assistant message per content block, all with the same `message.id`. A repeated id replaces the previous share instead of adding to it.
- A handoff stop fires at `contextTokens ≥ subagentHandoffTokens` and a safety stop at `weightedUsed ≥ subagentStopWeightedTokens`. Both values are read live through `CompactionConfigProvider.getConfig()`. Each subagent is stopped at most once, whichever limit it reaches first. The stop path: `registry.get(toolCallId).taskId` → `dispatcher.stopSubagent(sessionId, taskId)` → `registry.update(toolCallId, {status:'completed', completedAt})`. A completed record is dropped from the registry, so it is never offered for resume. After that, one parent message is pushed through `query.streamInput`, bounded by `SUBAGENT_SEND_TIMEOUT_MS`.
- No task id yet (task_started has not arrived): the stop is deferred to the next subagent message, with one warn line per subagent.
- A stop that fails is logged (error class only), sends no handoff and is not retried.
- No usage on a subagent message: observe-only, with one info line per session.

**Stack observed**: tsyringe `@injectable`/`@inject` with tokens (sibling `tool-output-capper.ts`; registrations in `di/register.ts:399-410`). There is no schema library; the untrusted stream message is narrowed with type guards inside the monitor. The `stopSubagent` signature is `(sessionId, taskId)` (`subagent-message-dispatcher.ts:258`). The `SubagentRecord.taskId`, `teammateName` and `SubagentStatus` values come from `libs/shared/src/lib/types/subagent-registry.types.ts`. The TTL type and its `'5m'` default come from `libs/shared/src/lib/utils/subagent-prompt-cache-ttl.ts`.

**Verification**

- `npx jest -c libs/backend/agent-sdk/jest.config.ts subagent-budget-monitor`: exit 0, 16/16 passed.
- `npx nx run-many -t lint,typecheck -p @ptah-extension/agent-sdk --parallel=2 --skip-nx-cache`: exit 0. The log does not mention the new files.
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: exit 1. The new monitor has no finding: the first run flagged `subagent-budget-monitor.ts:373` (a `return` inside a catch), and I restructured that code to a captured-failure flag. The only agent-sdk finding over the baseline (5 against 4) is `libs/backend/agent-sdk/src/lib/helpers/compaction/context-usage.port.ts:166`, which belongs to the concurrent 26b sub-batch, not 28a. Every other project is at or below its baseline.
- Prettier check: clean. No `*.png` was rewritten.

**Plan deviations**

- Handoff message text: the plan quotes "…with this handoff: <description>". The Task `description` is not available to the monitor: `SubagentRecord` has `agentType`, `teammateName` and `agentId`, but no description. The message instead names the type (and the teammate name, if there is one), the context or weighted figure and the limit, and says the subagent cannot be resumed. It tells the parent to start a fresh subagent that restates the task and what remains, with its output so far in the transcript. If the description must appear, 28b or a follow-up has to carry it from the Task `tool_use.input` to the monitor.
- The parent message push copies the dispatcher's `streamInput` single-message pattern and timeout. It does not share the dispatcher's per-session `serialisedPush` lock, because that lock is module-private in `subagent-message-dispatcher.ts`, which this batch does not own. A follow-up could export a `pushParentMessage` from the dispatcher and route both through it. The message omits the dispatcher's `origin: {kind:'human'}` cast, because this message is a system handoff and not human input.
- Not resumable is expressed as a registry status of `completed`, which deletes the record. The registry has no dedicated "not resumable" flag, and `getResumable` lists only `interrupted` records.

**Out-of-scope observations**

- The degradation-audit over-baseline finding at `context-usage.port.ts:166` (26b) will fail that check for the whole Wave D chain until 26b fixes or suppresses it.
