# Root causes: curator on Codex, and skill events never reconciled

Paths are relative to the worktree. "Verified" = read in source, logs, DB or specs. "Unverified" = inferred.
Source state: HEAD 7e0b461c8 (2026-11-04).

## Question A - curator fails with "Codex chat requires a host with the native Codex runtime."

### A1. The throw is NOT in RoutingAgentAdapter (verified)

`RoutingAgentAdapter.startChatSession` (`libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:90-135`) is the chat path. The curator never reaches it. The curator is an internal one-shot query, so the `nativeEnabled` / `this.native` / `this.admission` theory is a dead end.

Electron also grants the capability correctly: `apps/ptah-electron/src/di/codex-runtime-composition.ts:~82-86` returns `{nativeCodex:true, nativeCodexGateway:true}`.

The same message string is defined or thrown in 5 places:
- `routing-agent-adapter.ts` (chat)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:357` (a guard in `launch()` on the Codex proxy placeholder token)
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1640`
- `libs/backend/auth-providers/src/lib/auth/codex-native-runtime-refusal.ts:5`, the shared factory `codexNativeRuntimeRequired()`
- its callers, below

The curator's throw site is `ProviderAuthResolver.resolve()`:

```
libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:165-167
  if (providerId === 'openai-codex') { throw codexNativeRuntimeRequired(); }
```

The resolver does this deliberately for ANY one-shot override that names `openai-codex`. The same refusal sits in `curator-proxy-manager.ts:66-68` and `buildDraftOverride` (:560-562). `workspace-llm-resolver.ts:96-104` rethrows it for the "inherit workspace provider" path.

### A2. Exact call path (verified)

1. `SdkInternalQueryCuratorLlm.runQuery` (`curator-llm-adapter/sdk-internal-query.curator-llm.ts`, around :470-480) calls `resolveCuratorAuth`.
2. `resolveCuratorAuth` (:246-278) reads `memory.curatorProvider`. Here that is `"openai-codex"`, so it calls `this.resolver.resolve("openai-codex")` (:256).
3. The resolver throws `AuthRequiredError`. Its `.name` is `'AuthRequiredError'` (`libs/backend/agent-sdk/src/lib/errors/auth-required.error.ts:30`).
4. The catch at :258-277 handles only `ProviderQuotaError` (-> cooling-down) and `ProviderAuthError` (-> ride-active). Everything else is rethrown (:277).
5. The outer catch in `runQuery` (~:565-585) logs `[memory-curator] curator LLM query failed: {error:"Codex chat requires..."}`. The log lines are in `~/.config/Ptah/logs/Ptah Electron-2026-11-03..04.log`. It then throws `CuratorLlmQueryError`, the pass becomes `outcome:'failed'`, and the UI shows nothing (see `research-memory-curator.md`).

No query is ever started. Nothing depends on `consumer`, capability tokens or container scopes.

### A3. Why it started on Nov 3 (verified for the commits, inferred for the timing)

- Commits `5d9fbc1dd` "delete the Codex translation proxy (A4)" and `0f45b62bb` "drop proxy Codex code" (both 2026-11-02) removed the Codex Claude-SDK-via-proxy route. `a9497540e` "refuse retired Codex proxy routes" added the refusal. The installed /opt/Ptah build is dated Nov 3.
- Before this change, a curator pinned to `openai-codex` rode the translation proxy. Now there is no Codex route for one-shot queries.
- No commit after Nov 3 changes this. `git log` on `provider-auth-resolver.ts`, `curator-proxy-manager.ts` and `codex-native-runtime-refusal.ts` shows nothing newer than `0f45b62bb`.

### A4. Should the curator go through the chat routing adapter? (partly verified)

- No other one-shot caller supports Codex either. Every one-shot path that uses `ProviderAuthResolver` (curator, `structured-decision.adapter.ts`, `workspace-llm-resolver`, `provider-proxy-pool`, draft verification, ptah-cli-registry) refuses `openai-codex` with the same error. I found no "Codex internal query" path in `codex-runtime` or `codex-app-server`: a grep for oneshot/ephemeral there only hits protocol schema files. That grep is not exhaustive, so treat it as unverified.
- The native Codex runtime serves chat sessions and lanes (`cli-engine/.../codex-lane-runtime-composition.ts`) and the gateway (`consumer:'gateway'`). Building a native one-shot curator route would be a new feature: a Codex app-server thread per pass, with auth, models and tool handling. It is not the minimal fix.
- The model string `gpt-5.6-terra` is a Codex model. On a non-Codex provider it would be invalid, so the curator must not silently ride another provider with that model (see A5).

### A5. Fallback or error? (recommendation)

Existing semantics, verified in `sdk-internal-query.curator-llm.ts`:
- `ProviderAuthError` is recoverable: the curator logs a warn and uses `ride-active`.
- `ProviderQuotaError` is not retried elsewhere. The comment says the fallback provider is often the one that is rate-limited.
- `AuthRequiredError` is neither, so it escapes as a generic failed pass.

Recommended minimal fix, in 2 production files plus tests:
1. In `sdk-internal-query.curator-llm.ts` (`resolveCuratorAuth`, and `inheritWorkspaceProvider` for the inherit path), classify `AuthRequiredError` with `providerId === 'openai-codex'` as a named decision, for example `{kind:'unsupported-provider', providerId}`.
2. For that decision, do NOT ride the active provider and do NOT send the Codex model id to it. When the model is empty, `ride-active` is acceptable, but with a pinned Codex model it would send an invalid id.
3. `runQuery` returns a typed outcome. The curator surfaces a clear, actionable reason: "Curator provider openai-codex is not supported for background curation; choose another provider in Settings > Memory".
4. The `memory:runNow` handler returns `success:false` or a populated reason. `memory-rpc.handlers.ts:699-705` currently returns `success:true` for `outcome:'failed'`. This is the missing-UI-feedback finding from `research-memory-curator.md`.
5. Settings: stop offering `openai-codex` (and any other provider the resolver refuses) in the curator provider picker. The webview-e2e fixture `settings.fixtures.ts:274` currently pins it. This is a frontend change; the picker source was not located (unverified).

Fallback alternative, more permissive: on that refusal, ride the workspace or active provider and drop `curatorModel`. This is defensible, but it silently changes the provider and the cost, so I recommend the explicit error instead. A product owner should decide this.

Regression tests:
- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts`. The pattern is at :480 (`proceeds with auth=undefined ... ProviderAuthError`) and :453. Add a case: resolver throws `AuthRequiredError({providerId:'openai-codex'})`, and assert the named outcome and that no query starts.
- `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.spec.ts:~1075` already pins the refusal. No change is needed.
- Run: `npm run verify -- -t test -p agent-sdk` (and `rpc-handlers` if the handler changes).

## Question B - skill events never reconciled

### B1. Real data (verified; DB opened read-only via Python, since `sqlite3` is not installed)

- `skill_invocation_events`: 431 rows (the prompt said 427; the count has grown). The sources are 376 `subagent` and 55 `slash-command`. All have `reconciled_at` NULL.
- Only 11 distinct non-null `task_id` values exist for the main workspace (206 rows with a task id). 129 subagent rows in `/home/amun/ptah-extension` have `task_id` NULL. Event time range: 2026-10-26 to 2026-11-04.
- `.harvested.json` markers: 241 (matches "241 specs harvested"), all `version:2` and ALL `reconciledCount:0`.
- Of the 241 specs, only ONE (`TASK_2026_864_1376`, `status: done`) is a task that has events. The other tasks with events (853, 855, 858, 859, 865, 878...) are `in_progress`, so they are skipped by `if (!spec.completed) continue` (`spec-harvester.service.ts:~104`). That is correct behaviour and not a bug.
- `skill_task_grades`: 1 row, the `nx-video` TASK_2026_001 researcher-expert.

### B2. Root cause #1: the batch parser does not match the current `batches.md` format (verified)

`spec-extractor.ts:~159-169` (`parseBatchVerdicts`) requires, per `## Batch` block, the literal bold-and-capitalised `**Recommended Executor**:` (regex `/\*\*Recommended Executor\*\*:\s*(.+)/i`).

Real specs in `/home/amun/ptah-extension/.ptah/specs`:
- Only 5 of 35 `batches.md` files contain `**Recommended Executor**:`. They are TASK_2026_237, 257, 299, 331 and 362, all old. Of those, 237 and 331 yield 0 terminal batches, and 362 is `backlog`.
- The current format is a bullet: `- Recommended executor: CLI lane [TypeScript backend implementation]` (see `TASK_2026_864_1376/batches.md:123`) or `- Recommended executor: CLI lane, backend capability (agent shape: backend-developer)` (859). The regex does not match it.
- Even if it matched, `normalizeExecutor("CLI lane ...")` returns `cli`, which equals no agent slug (its own docblock admits this: "CLI agent reduces to a harmless token").
- Result: `spec.batches` is `[]` for every modern spec. `reconcileSubagentEvent` is never called, so `reconciledCount` is 0. This matches 241/241.

Both of these are also true: the heading format `## Batch N: ... - COMPLETE` is fine, and `detectStatus` treats `IMPLEMENTED` as unresolved (`IMPLEMENTED` batches are skipped).

### B3. Root cause #2: attribution model is wrong for the current workflow (verified by reading, plus the DB)

`events.reconcileSubagentEvent` (`skill-invocation-event.store.ts:196-244`) matches (slug = batch executor, `source='subagent'`, `task_id = spec.taskId` or null-task rows in the window). But today's `subagent` events are the roles that ran: team-leader, code-logic-reviewer, software-architect and so on. The batch executors are CLI lanes, not subagents.

So even a fixed regex would reconcile at most a few rows. The executor concept does not map to these events. For the one completed task (864), the 44 events with `task_id=864` (24 team-leader, 7 code-logic-reviewer, ...) have no corresponding batch executor slug.

### B4. Root cause #3: one-shot reconciliation, never retried (verified)

`spec-harvester.service.ts:~116`: `for (const batch of marker ? [] : spec.batches)`. Once `.harvested.json` exists, a later digest change skips reconciliation. The marker is written with `reconciledCount: 0` and never revisited. Fixing the parser later would therefore not reconcile the 241 existing specs, because the markers block it. It needs a marker version bump (`MARKER_VERSION = 2` -> 3) or a "reconciledCount === 0" retry.

### B5. Why grades are also nearly empty (partly verified)

`SkillTaskGradeStore.findAttributions` (`skill-task-grade.store.ts:134-170`) does find attributions for 864: 44 events pass the `skill_registry` join (verified by query). But `writeGrades` (`spec-harvester.service.ts:~148-185`) only writes a grade when a batch (never, by B2), a lane `finalReview`, or a matching review verdict exists. Review matching needs `runId` / `sessionId` in the review frontmatter, or exactly one sibling attribution per slug. 864 has many sibling team-leader runs and its reviews appear to lack run ids (unverified: I did not read the review frontmatter), so no verdict is selected. That is why only 1 grade exists.

### B6. Fix size

Not tiny and not a pure design change. The recommendation is to reconcile at task level, not batch level:
- (a) `spec-harvester.service.ts`: for a completed spec, reconcile every unreconciled `source='subagent'` event with `task_id = spec.taskId` (and `workspace_root` match) using a task-level verdict (`status: done` -> succeeded, otherwise per review verdict). Add a store method in `skill-invocation-event.store.ts` for the batch update. This avoids the executor-slug mismatch entirely.
- (b) `spec-extractor.ts`: optionally make the executor regex tolerate `- Recommended executor:` for legacy per-batch behaviour. Low value on its own.
- (c) Bump `MARKER_VERSION` so the 241 markers are re-evaluated. Because (a) is idempotent via `reconciled_at IS NULL`, re-running is safe.
- Tests: `spec-harvester.service.spec.ts` and `skill-invocation-event.store.spec.ts`.

That is 2-3 production files, which meets the "<= 3 files" bar, with one design choice for the owner: is a reviewer or architect "succeeded" just because the task finished as `done`? Run-level verdicts (via `lane_outcome_records.final_review` or review frontmatter `run_id`) would be more precise but need more work. Specs lacking `task_id` stamps (129 null-task events) can only use the time-window fallback, which needs a window-per-task query instead of the batch-slug key.

## Unknowns

- Whether an AI-selectable "inherit workspace provider" curator path can also resolve to `openai-codex`. The code path exists in `workspace-llm-resolver.ts:96-104` but was not exercised.
- Where the Settings curator-provider picker lists providers, and whether it already hides Codex (not located).
- Review-file frontmatter content for TASK_2026_864 (run ids) - not read.
- The `sdk-query-runner.service.ts:357` guard may also trigger on the active-provider path if the curator rides a Codex active provider. It was not tested.
