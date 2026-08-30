# TASK_2026_328 — memory.enabled key, internal-query wait ceiling, readJsonlTail

Source: regression review of TASK_2026_323 (B2, B4, B6).

## Findings to fix

1. **`memory.enabled` is not in `FILE_BASED_SETTINGS_KEYS`.**
   Key defined at `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:6-17`;
   registry at `libs/backend/platform-core/src/file-settings-keys.ts:209-219, 320-328`
   holds every sibling `memory.*` key. Required: add `memory.enabled` to the
   registry (same section as `memory.triggers.*`) and add an assertion in
   `file-settings-keys.spec.ts`. Do NOT edit `memory-trigger.service.ts`
   (TASK_2026_330 owns it).

2. **Internal-query gate (default 1) queues wizard calls with no wait ceiling.**
   `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`.
   Callers with no abort controller: `libs/backend/agent-generation/.../content-generation.service.ts:273`,
   `agent-customization.service.ts:178`. Callers that arm the timeout after
   `execute()` resolves: `enhanced-prompts.service.ts:710-719`,
   `wizard/agentic-analysis.service.ts:170-195`,
   `wizard/multi-phase-analysis.service.ts:421-438,546`.
   Correct pattern: `skill-enhancer.service.ts:734-738`, `harness-llm-runner.service.ts:104-105`.
   Required: (a) `execute()` accepts `queueTimeoutMs` (default from
   `ptah.internalQuery.queueTimeoutMs`, default 60 000) and rejects with a typed
   `InternalQueryQueueTimeoutError` when the gate is not acquired in time;
   (b) the five callers arm their abort controller before `execute()`;
   (c) constructor: `@inject(TOKENS.LOGGER, { isOptional: true })` and the same for
   `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, matching `sdk-internal-query.curator-llm.ts:130,132`.
   Spec: gate held → second `execute` rejects after the timeout; abort while queued
   leaves the queue consistent (existing gate spec pattern).

3. **`readJsonlTail` drops a real first line when `windowStart === 1`.**
   `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:233-267`.
   Repro: file `AAA\nBBB\nCCC\n`, `maxBytes = 11` → `['BBB','CCC']`.
   Required: only drop the first parsed line when the read did not start at byte 0.
   Spec: the repro above returns all three lines.

## Verify

```bash
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/agent-generation @ptah-extension/memory-curator
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/agent-generation
```
