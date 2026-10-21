# Batch 6 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/spec-extractor.ts:53-305` — bounded artifact reads, task-root validation, review and judge verdict parsing, artifact digest and bounded diagnostics.
- `libs/backend/skill-synthesis/src/lib/spec-extractor.spec.ts:1-294` — explicit verdict, malformed judge, digest correction and outside-root coverage.
- `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:72-425` — versioned marker, digest refresh, grade selection, legacy candidate reconciliation, workspace-root guard and findings lookup.
- `libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts:1-571` — legacy marker upgrade and corrected review replacement coverage.
- `libs/backend/skill-synthesis/src/lib/spec-findings.port.ts:1-21` — optional subject kind for grade-linked findings.
- `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts:22-200` — exact event/lane attribution, unique session-task link, grade invalidation and grade-linked findings lookup.

## Write paths and readers

- Grade rows: `SpecHarvesterService.writeGrades` reads `HarvestedSpec` verdicts and calls `SkillTaskGradeStore.upsert`; `removeAbsent` invalidates a prior grade when corrected evidence no longer supports it. The rate reader is `SkillScorecardService` through `SkillTaskGradeStore.getAggregates`. `getRecentFindings` uses `hasGradeForTask` to feed grade-linked findings to the enhancer port.
- Marker: `SpecHarvesterService.writeMarker` writes `.ptah/specs/TASK_*/.harvested.json` with `version: 2` and `artifactDigest` after processing. `readMarker` reads it in `harvest`, `listSpecs` and `clearStaleSpecs`. A changed digest or legacy marker triggers re-harvest; an unchanged version-2 marker skips it. The first harvest still runs the old candidate reconciliation; later corrections update grade rows without re-running that path.

## Precedence and attribution

1. A unique explicit batch executor verdict wins, then an exact lane `final_review`, then an explicit matching review verdict. Final `*-review.md` evidence takes precedence over earlier `judge-round-*.json` rounds. Conflicting reviews at the selected rank produce no grade.
2. A grade requires an exact task/workspace event or lane record, or an event with a unique session/task link in that workspace. Registry slug and subject kind must match. A review with a run ID matches that run; session-only and task-level reviews require a unique candidate for the subject. Ambiguous/unlinked facts stay ungraded.
3. A corrected artifact changes the digest and UPSERTs the same `(task, kind, slug, attribution key)` row. Duplicate event and lane evidence for a run is collapsed; stale grades for the task/workspace are removed.
4. Invalid or oversized artifacts contribute no review grade and emit bounded diagnostics without raw review content. Plan/architecture review text contributes only to findings unless it carries exact run/session attribution.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep legacy candidate reconciliation on the initial harvest only; use the new grade path on every digest refresh. | Phase A requires the old path to keep working, while the old store's `reconciled_at` guard prevents correction in that table. The new grade store UPSERT supports correction. | Yes |
| Require a Library registry match for event/lane subject kind and slug. | The plan requires subject normalization against the Library, and the telemetry source distinguishes subagent, Skill tool and slash command. Unmatched subjects stay ungraded. | Yes |
| Treat a review without run/session attribution as task-level evidence for a unique agent candidate only. | The plan forbids grading all uses of a slug when multiple runs could match. | Yes |

## Verification

Scoped `ptah_get_diagnostics` reported 0 errors across the six changed files. Tests, Nx, lint, build and e2e were not run, as instructed for this lane; the orchestrator owns the project test/typecheck gate. All changed source/spec files use LF endings.
