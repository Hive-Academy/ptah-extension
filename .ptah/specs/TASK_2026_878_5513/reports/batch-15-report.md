# Batch 15 report: spec extractor verdicts and guarded grade store

- Task: TASK_2026_878_5513, Phase C (Skills), Batch 15
- Executor: `backend-developer` subagent (claude family, in-process). Per batches.md, Phase C review
  therefore goes to a CLI lane of another family (decisions.md row 21).
- Worktree: `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions`. No git commands were run.

## Files

- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/spec-extractor.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/spec-extractor.spec.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/skill-task-grade.store.spec.ts`

No other file was touched. `reconcileSubagentEvent` and the harvester were left unchanged in this
batch (R6).

## Task 15.1: Extractor task status, review mtime, suffixed reviews, bold verdicts, `taskVerdict`

Evidence (`spec-extractor.ts`):

- `HarvestedSpec.taskStatus: TaskStatus` (line 43). It is set from `parsed.task.status` in
  `extractSpec`. `TaskStatus` comes from `@ptah-extension/shared` and is narrower than the plan's
  `string` (see Decisions).
- `SpecReviewVerdict.modifiedAt: number` (line 65). `extractSpec` reads it with `lstat(join(dir, file))`
  (line 327) after the file passes the `safeRead` containment check. A file that disappears between
  the read and the `lstat` gets mtime 0 and a diagnostic line,
  `<file>: modification time unavailable`. A `degradation-audit: reported` marker justifies that
  `.catch`.
  `parseReviewVerdict(file, content, digest, modifiedAt)` now carries the mtime into the verdict.
- File filter: `REVIEW_FILE_PATTERN` (line 78) is
  `^(?:[\w-]+-review(?:-[\w-]+)?\.md|test-report(?:-[\w-]+)?\.md|judge-round-\d+\.json)$`. It matches
  `code-logic-review-phase-a.md`, `visual-review-home.md`, `test-report-*.md` and the old forms.
  The count check now uses the same filtered list.
- Verdict regex (line 139): `\s*:\s*(?:\*\*\s*)?` after the label. It accepts `Verdict: **APPROVED**`,
  `**Verdict:** REVISE`, `**Verdict: REVISE**`, `Verdict: **NEEDS_REVISION**`, `- **Verdict**: **PASS**`
  and `**Verdict:**APPROVED`. The section-heading form (line 144) also accepts a bold value on the
  next line (`## Verdict\n\n**REJECTED**`). All earlier forms still parse (the existing sample test
  is unchanged and passes).
- `isDocumentReview(file)` (line 160) uses `DOCUMENT_REVIEW_PATTERN`. It matches the tokens `plan`,
  `architecture`, `design-spec` and `task-description` when they are delimited by `-` or `.`.
  `code-style-review-planner.md` is not a document review.
- `taskVerdict(spec)` (line 173) is pure and follows P3:
  - `cancelled` gives `failed`.
  - `done` takes the latest work review by `modifiedAt`: pass gives `succeeded` and fail gives
    `failed`. Document reviews are excluded.
  - `done` with no work review gives `null`, and so does every other status.
  - When reviews tie on the latest mtime with different verdicts, the result is `null` (see
    Decisions).

Tests (`spec-extractor.spec.ts`):

- Bold verdict forms, including a `pending` value that stays null.
- Document versus work review classification.
- `taskVerdict`:
  - cancelled with and without reviews;
  - done with the latest pass or the latest fail;
  - REVISE then APPROVED gives succeeded;
  - APPROVED then a rejecting `test-report.md` gives failed;
  - done without a work review gives null;
  - a newer plan review is ignored;
  - a mixed tie gives null and an agreeing tie gives succeeded;
  - backlog, in_progress, in_review and blocked give null.
- An `extractSpec` fixture with suffixed reviews and `utimes`-set mtimes asserts:
  - file, verdict and `modifiedAt` for each review;
  - that `research-report.md` is not read;
  - `taskVerdict` gives `succeeded` (the newest plan review is ignored).
- `taskStatus` is asserted for done, cancelled and in_progress folders.

## Task 15.2: Guarded `upsert` and workspace-scoped `hasGradeForTask`

Evidence (`skill-task-grade.store.ts`):

- `upsert(grade): boolean` (line 118). The `DO UPDATE` ends with
  `WHERE skill_task_grades.workspace_root IS NULL OR skill_task_grades.workspace_root = excluded.workspace_root`
  (line 132), and the method returns `result.changes > 0` (line 139). `excluded.workspace_root` is the
  normalized root the method already binds. A row with a NULL root (legacy 0056 backfill) is adopted.
  A row owned by another workspace is never overwritten. A NULL-root write over an owned row is also
  refused, because `<root> = NULL` is not true.
- `hasGradeForTask(taskId, slug, kind?, workspaceRoot?)` (line 198) runs one statement with
  `AND (? IS NULL OR workspace_root = ?)` and binds `normalizeWorkspaceRoot(workspaceRoot)`. Without a
  root it behaves as before.
- The `lane_outcome_records` join in `findAttributions` (line 152) is unchanged, and so is the
  `laneRows` read-only query.

Tests (`skill-task-grade.store.spec.ts`, real SQLite):

- `refuses to overwrite a grade owned by another workspace (A5)`:
  - workspace A writes (true);
  - workspace B writes the same key (false), and a NULL-root write also returns false;
  - `JSON.stringify(SELECT * FROM skill_task_grades)` is identical before and after, with one row;
  - A can still update its own row with a trailing-separator spelling (true).
- `adopts a legacy NULL-root grade into the writing workspace`: the NULL-root row is updated, with
  root, verdict and `graded_at` replaced, and the call returns true.
- `scopes hasGradeForTask to the given workspace root`:
  - root A gives true, including the trailing separator and without a kind;
  - root B gives false;
  - the wrong kind gives false;
  - no root gives true, as before.

## Verification

Command (run from W): `npm run verify -- -p @ptah-extension/skill-synthesis 2>&1 | tail -60`

The header line "Running target ... for N projects" did not appear in this Nx version's output. The
output reports the task count instead: `NX   3 tasks: 2 succeeded, 1 failed`. That is lint, typecheck
and test for the one requested project (N=1).

Result tail:

```
 NX   3 tasks: 2 succeeded, 1 failed
✖ nx run @ptah-extension/skill-synthesis:test
  Run duration:      14m 28s
[verify 2026-11-04T22:02:36.794Z] lock released after 911.5s, exit code 1
```

From the Jest log in the Nx cache:

- `Test Suites: 13 failed, 22 passed, 35 total`
- `Tests: 1 skipped, 409 passed, 410 total`

No test failed. All 13 failed suites stopped at load with the same configuration error:

```
Could not locate module marked mapped as:
/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/node_modules/marked/lib/marked.umd.js.
  at ../tool-output-reducers/src/lib/reducers/markdown.reducer.ts:30:1
  at ../agent-sdk/src/index.ts:179:1
```

Cause: the worktree has no `node_modules`. `ls node_modules` in W gives "No such file or directory".
`jest.preset.js:34-36` maps `^marked$` to `<preset dir>/node_modules/marked/lib/marked.umd.js`, a path
that only exists in the main checkout. The failing suites are:

- `lane-runner.*` (5 suites)
- `skill-enhancer`
- `skill-judge`
- `subagent-metrics-extractor`
- `trajectory-extractor`
- `skill-trigger.integration`
- `skill-trigger.service`
- `di/register`
- `foreground-activity.tracker`

All of them import `@ptah-extension/agent-sdk`, and none is a Batch 15 file. Per the lane rules,
those files were not edited.

Lint and typecheck both succeeded.

Re-run, after more than 2 minutes, of the Batch 15 suites only:
`npm run verify -- -t test -p @ptah-extension/skill-synthesis -- --testPathPatterns="spec-extractor|skill-task-grade"`

```
[verify 2026-11-04T22:07:56.484Z] lock slot 1 acquired after 271s: verify test (@ptah-extension/skill-synthesis)
 NX   1 task: 1 succeeded
[verify 2026-11-04T22:09:34.075Z] lock released after 97.6s, exit code 0
```

The full-project failure is environmental and still present (see the Batch 16 report for the second
full run). It needs a team-leader fix outside this batch's files: either provide `node_modules` in the
worktree, or resolve `marked` in `jest.preset.js` from the package resolution path.

## Risks and assumptions

- R6: the store's reconcile API and the harvester's batch loop are untouched in this batch. The
  harvester ignores `upsert`'s new return value until Batch 16.
- R7 (store half): the guarded upsert and the scoped `hasGradeForTask` are in place and tested. The
  two-workspace marker-upgrade test is in Batch 16.
- A5: verified. A refused `ON CONFLICT ... DO UPDATE ... WHERE <false>` reports `changes === 0`, so
  `upsert` returns `false`. The test asserts this and also that workspace A's row is byte-identical.
- The `lane_outcome_records` read-only join is unchanged.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Type `HarvestedSpec.taskStatus` as `TaskStatus` (shared), not `string` | `string` (plan wording); `TaskStatus` | `parseTaskFile` already returns a narrowed `TaskStatus` (`task-frontmatter.ts:272`); the narrower type is assignable to `string` for every consumer | yes |
| Mtime via `lstat` after the containment check, with 0 and a diagnostic on a race | reuse `safeRead`'s `stat`; separate `lstat` | Batch text names `lstat`; the marker reader uses `lstat` too; for regular files both give the same mtime | yes |
| `parseReviewVerdict` takes `modifiedAt` as a required 4th argument | separate type without mtime; default argument; required argument | One verdict type end to end, no hidden default; only `spec-extractor.spec.ts` calls it besides `extractSpec` | yes |
| A tie on the latest mtime with different verdicts gives `null` (unreconciled) | latest file name wins; fail wins; null | P3 is conservative attribution (decisions.md row 15); a tie has no "latest" review | yes |
| Document-review matching uses delimited tokens (`-plan-`, `plan-`, `.`), not the substring `/plan\|architecture/` | substring; token | Avoids treating `*-planner*` work reviews as document reviews; covers every P3 example | yes |
| Suffixed `test-report-*.md` files are read as reviews | only `*-review*.md`; also test reports | Plan component 8 lists `test-report-*.md` explicitly | yes |
| `taskVerdict` and `isDocumentReview` are not added to the library barrel | export; keep internal | The barrel (`src/index.ts`) is outside this batch's file list and only the harvester (same lib) uses them | yes |
