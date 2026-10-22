# Batch 4 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts:4-65`: route inserts to `SkillInvocationEventStore`, write `succeeded: null`, forward explicit `isError`, accept `slash-command`, and keep event sources distinct in deduplication.
- `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.spec.ts:4-162`: verify all classified kinds remain ungraded, tool success and error flags are independent of grades, and Skill and Command events do not deduplicate each other.
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:505-753`: capture subagents with no observed error, Skill and Task tool errors from `!payload.success`, slash commands under `slash-command`, and MCP prompt expansions under the existing unclassified source. Existing enqueue calls remain.
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts:36-2066`: update event expectations, add MCP classification coverage, and assert persisted subagent rows have NULL grades.
- `libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts:57-58, 150-151, 400-405, 558-649`: resolve the registered event store, supply an explicit error flag to the recorder, and verify its NULL-grade write and slug attribution in SQLite.
- `subagent-metrics-extractor.ts` and its spec needed no edit: their transcript metrics and task attribution carry no observed tool success or failure; the PostToolUse callback supplies the explicit tool error signal.

## Write path and readers

`SkillTriggerService` passes slug, session, workspace, context fingerprint, timestamp, source, explicit error flag, and optional subagent run ID, task ID, and metrics to `SkillInvocationRecorder`. The recorder calls `SkillInvocationEventStore.recordSkillEvent` for every new row. The store writes `skill_slug`, `session_id`, `workspace_root`, `context_id`, `source`, `succeeded=NULL`, `is_error`, `invoked_at`, metrics, `task_id`, and `run_id`.

| Kind | Source | Error flag | Attribution |
| --- | --- | --- | --- |
| Agent | `subagent` | `false` on SubagentStop; `!payload.success` on Task PostToolUse | Run ID and transcript task ID when observed |
| Skill | `tool-use` | `!payload.success` | Session and workspace |
| Command | `slash-command` | `false` (expansion callback has no error field) | Session and workspace |
| Unclassified | `prompt-expansion` for MCP prompts and historical rows | `false` for new MCP events | Session and workspace |

`SkillTelemetrySeamAdapter` reads subagent runs and Skill use windows through the event store. The current `SkillCandidateStore` and `SkillScorecardService` still read the same table during Phase A; later batches replace their grade interpretation with `skill_task_grades`. Source is the event kind discriminator because migration 0056 adds no `subject_kind` column to `skill_invocation_events`.

## Verification

No test, Nx, lint, build, or e2e command was run, as requested. The previous scoped diagnostic found a stale recorder call in the reachability spec; that call is now updated. The edited source and spec files use LF line endings.

## Decisions

- **NULL grades for all new events.** Options were to propagate callback success or write NULL. Migration 0056 makes `succeeded` nullable and the plan reserves grades for task-grade evidence. Reversible by changing the recorder.
- **Use the registered event store directly.** Options were to retain `SkillCandidateStore` or use `SkillInvocationEventStore`. Batch 3 already registered the latter and assigned it event inserts. Reversible through DI and recorder changes.
- **Keep MCP prompts under `prompt-expansion`.** Options were to create another source or leave them unclassified. The batch explicitly keeps MCP prompts and historical prompt expansions unclassified. Reversible in a later source migration.
- **Leave subagent transcript extraction unchanged.** The callback and JSONL extractor have no reliable completion grade. Error flags are assigned only where a tool callback explicitly reports failure. Reversible if a future provider supplies a reliable error signal.

## Resolution

Orchestrator decision O1 expanded batch 4 ownership to the reachability spec. Its recorder call now uses `isError: false`; the test asserts the registered event-store call, NULL grade, explicit error flag, persisted rows, and collision-suffixed slug. No duplicate candidate-store write was added.
