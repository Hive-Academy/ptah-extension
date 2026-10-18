# Phase A fix round (one round) - TASK_2026_662

Source reviews: `code-logic-review.md` (L-), `code-style-review.md` (St-). Both REVISE 6/10.
Rule: fix every Serious; fix Moderate only when it can lose data or break config; otherwise a named
later task. SS = `libs/backend/skill-synthesis/src/lib`, RH = `libs/backend/rpc-handlers/src/lib`.

## Lane A1 (codex) - review harvest: `SS/spec-extractor.ts`(+spec), `SS/spec-harvester.service.ts`(+spec)

1. L-S1 `SS/spec-extractor.ts:76-81,108-120` - recognise this repository's review format:
   `Recommendation: APPROVE|APPROVED|REVISE|NEEDS_REVISION` and the `## Verdict` section (plus the
   existing `Verdict:` line). Add a spec that parses real-format samples (copy 2-3 short excerpts of
   `code-logic-review.md`/`code-style-review.md` endings from `.ptah/specs/*/` into fixtures inline).
   A review file with no recognised verdict logs one bounded diagnostic (no review text).
2. L-M1 `SS/spec-harvester.service.ts:170-178` - evaluate the conflict gate only for verdicts whose
   source is `review`; batch and lane verdicts keep precedence.
3. L-M2 `SS/spec-harvester.service.ts:122` - stop passing `isError` into the legacy reconcile
   (`applyReconciliation`); keep the existing `is_error` value (batch 4 made it independent of grade).
4. L-M4 `SS/spec-harvester.service.ts:150` - normalise the workspace root with the same helper the
   grade store uses before comparing (see `SS/skill-task-grade.store.ts:113`; do not edit that file -
   if no shared helper exists, normalise on the harvester side to the exact form the store writes).
5. L-M6 `SS/spec-harvester.service.ts:134,152-158` - when attribution or a grade write fails, do NOT
   write the `.harvested.json` marker, so the next harvest retries.

## Lane A2 (codex) - stores and settings: `SS/skill-task-grade.store.ts`(+spec), `SS/skill-invocation-event.store.ts`(+spec), `SS/skill-candidate.store.ts`(+spec), `SS/skill-synthesis.service.ts`(+spec)

6. L-M5 `SS/skill-task-grade.store.ts:146-154` - `removeAbsent` must never delete rows whose
   `evidence_source` starts with `spec:` (0056 backfill), and must be a no-op when the attribution
   list is empty.
7. St-M1 `SS/skill-task-grade.store.ts:68,120,127,148,170,184` - parse DB rows with Zod row schemas
   (pattern `SubagentRunRowSchema`, `SS/skill-invocation-event.store.ts:12`); use or drop the Logger.
8. L-M3 `SS/skill-invocation-event.store.ts:108`, `SS/skill-candidate.store.ts:1661` - add
   `'slash-command'` to the `source IN (...)` scope filters.
9. L-S3 `SS/skill-synthesis.service.ts:1619-1630` - when the settings RPC writes the old judge
   provider/model/enhance-timeout keys, also write the matching `skills.enhancement.*` keys
   (dual-write until batch 17 switches the UI). Key names: libs/backend/platform-core/src/file-settings-keys.ts.

## Lane B (codex) - contracts and engines: `RH/handlers/skills-synthesis-rpc.handlers.ts`(+spec), `libs/backend/agent-generation/src/lib/services/user-layer/source-hash.ts` and `user-layer-mirror.service.ts`(+spec) and the agent-generation public index, `RH/handlers/skills-synthesis-rpc.schema.ts`, `SS/skill-enhancer.service.ts`(+spec), `libs/backend/persistence-sqlite/src/lib/migration-runner.ts`(+spec), `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts`(+spec), `libs/backend/platform-core/src/file-settings-manager.ts`(+spec)

10. L-S2 `RH/handlers/skills-synthesis-rpc.handlers.ts:2311-2314` - return `successRate: null` whenever
    `succeeded + failed < total` (ungraded events present). Spec: ungraded invocations give null, not 0.
11. St-S1 - add `formatSourceHash(body)` to `source-hash.ts`, export it from the agent-generation
    public index, use it in `SS/skill-enhancer.service.ts:462` and both mirror `currentHash` sites;
    reference it in the schema regex comment. First confirm skill-synthesis may import
    agent-generation (`project.json` tags / existing imports); if not, put the helper in
    `libs/shared` instead and say so.
12. St-S2 - extract the duplicated stale-source guard in `user-layer-mirror.service.ts`
    (`saveDirCloneBody`, `saveFileCloneBody`) into one private helper; behaviour unchanged.
13. L-M7 `SS/skill-enhancer.service.ts:459-463,560-564,981-984` - restore error diagnostics on the
    proposal/candidate generation warns as `error.name` plus a sanitised message (no credentials;
    the auth site at ~:885 stays as decision O3).
14. St-S3 - one exported constant for the first destructive version (57) and the archive dir prefix
    in `skill-pipeline-archive.ts`; `runVecCatchUp` takes an options object; `ensureArchive` becomes a
    private method. Behaviour unchanged.
15. L-M8 `libs/backend/platform-core/src/file-settings-manager.ts:~538-560` - the one-time settings
    migration rewrite must use the existing locked/atomic persist path, not an unlocked rewrite.

## Deferred (named later tasks, recorded in batches.md by the team-leader)

- L-M9 archive Windows file modes and archive directory accumulation -> batch 67 (archive wiring).
- St-M2 move attribution grouping out of `SkillTaskGradeStore` into a pure function -> batch 44.
- St-M3 move `SKILL_SETTINGS_MIGRATIONS` to `file-settings-keys.ts` -> batch 65 (key removal).
- Minor findings in both reviews: recorded only.
