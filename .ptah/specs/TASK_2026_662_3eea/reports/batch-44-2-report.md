# Task 44.2: Phase A review carry-overs

## N1

Changed the Markdown verdict capture to take the first verdict token, plus an optional `revision` word. Added the exact `Recommendation: APPROVE with minor changes` regression case to the existing verdict-format spec. Existing `NEEDS REVISION` and `NEEDS-REVISION` cases remain in that table.

## St-M2

Moved attribution ambiguity grouping and row conversion from `SkillTaskGradeStore.findAttributions` into the pure `groupGradeAttributions` function in the same file. Added SQLite-independent specs for duplicate facts, conflicting sessions, ambiguous event keys, and independent keys. No new helper file was needed.

## M1

The harvester now caps grade-write attempts at three per spec directory and artifact digest within a service session. A changed digest can be attempted again. Each failed attempt uses the injected logger; further harvests of an unchanged failing spec make no write attempt or repeat warning. Added a persistent-failure spec that harvests five times and checks three write attempts, three warnings, and no marker.

## M2

An empty keep-list now prunes stale non-spec grades for the task and workspace. Added a store spec for the empty list that checks stale grades are removed while `spec:` backfill remains, and a harvester assertion that conflicting reviews pass an empty keep-list to pruning.

## Decisions

- Kept the pure grouping function in `skill-task-grade.store.ts` so the change stays within the six permitted source/spec files and the store's public methods stay unchanged.
- Chose pruning for M2 because a corrected, conflicting review should not leave an old success grade in the scorecard. The existing task/workspace and evidence-source filters bound deletion; `spec:` backfill remains preserved.
- A capped failure leaves the spec unmarked so the grade is not reported as harvested. A corrected artifact digest re-enables attempts. The cap is per service session.
- No tests, typecheck, lint, build, serve, or e2e were run, as instructed. Workspace filtering remains for Task 44.3.

## Clarifications Needed

None.
