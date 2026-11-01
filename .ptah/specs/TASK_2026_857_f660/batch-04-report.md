# Batch 4 test report

## Cases and acceptance criteria

The requirement prose supplies the acceptance criteria. This batch covers the Req 2 write and persistence seams, the Req 3 metadata enrichment seam, and the Req 7 report identity seam.

| Spec                                       | Cases added                                                                                                                                                                                                               | Requirement                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| lane-outcome.schema.spec.ts                | Round-trip each of explicit, mapped, classified, unclassified; decode null and omitted legacy source as null; reject unknown source.                                                                                      | Req 2: four provenance values and readable old rows.             |
| lane-outcome.schema.spec.ts                | Accept review-only reviewerRunId at lengths 1 and 200; reject lengths 0 and 201 and reject the field on a deliverables report.                                                                                            | Req 7: bounded reviewer identity.                                |
| write/report-effect.spec.ts                | For each existing source and null, apply a report kind; retain an explicit kind and promote other sources to explicit. For each source and null, omit the report kind and retain both previous values.                    | Req 2: report precedence and no null overwrite.                  |
| write/report-effect.spec.ts                | Assert review:<reviewed>\|<reviewer> format, deterministic repeat, and distinct reviewer identity.                                                                                                                        | Req 7 / D-5: stable receipt identity.                            |
| store/sqlite-lane-outcome.store.spec.ts    | Apply registered 0054 and 0064 lane-outcome SQL in real SQLite; read a legacy null source; insert/read mapped source. Classify an unclassified row, reject missing/repeated updates, protect explicit and mapped sources. | Req 2: migration, column round-trip, conditional classification. |
| store/sqlite-lane-outcome.store.spec.ts    | Fill null join fields, retain existing subagent ID, assert missing/no-op results.                                                                                                                                         | Req 3: later producer enriches only absent metadata.             |
| store/in-memory-lane-outcome.store.spec.ts | Classify only the kindless unclassified row; preserve explicit/mapped evidence; reject missing run. Enrich only null join fields and reject missing/no-op updates.                                                        | Req 2 and Req 3: store parity.                                   |
| store/key-value-lane-outcome.store.spec.ts | Classify and enrich, reload storage and assert both mutations persist; protect explicit kind after reload; reject missing/no-op updates.                                                                                  | Req 2 and Req 3: durable KV parity.                              |

The unclassified row before classification is asserted with a null kind and unclassified source. It remains so until setClassifiedTaskKind is called. This is the Batch 4 store-level edge for an unset decision model; recorder model-call behavior belongs to a later batch.

The SQLite case applies the registered migrations affecting the lane-outcome table (0054 and 0064). It does not replay unrelated workspace migrations; persistence-sqlite separately tests 0064 registration and migration behavior.

## Files touched

- D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\lane-outcome.schema.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\write\report-effect.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\in-memory-lane-outcome.store.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-04-report.md

## Verification

- Scoped ptah_get_diagnostics after edits: 0 errors, 0 warnings, clean coverage. SQLite fixture correction checked again: 0 errors, 0 warnings.
- First required verify run: exit 1; Jest 13 suites and 147 tests passed, one new migration case failed because its raw legacy fixture omitted required family. Corrected the fixture; this was a test-data error.
- Final command: npm run verify -- -p @ptah-extension/lane-outcomes 2>&1 | Select-Object -Last 40; exit 0. Nx: 3/3 tasks succeeded. Jest terminal output: 14/14 suites and 148/148 tests passed.

Final verify tail:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/lane-outcomes

[verify 2026-10-30T18:53:21.143Z] waiting on queued pid 31256 [verify test (@ptah-extension/agent-sdk)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T18:53:20.147Z
[verify 2026-10-30T18:53:23.164Z] waiting for a slot: 2/2 held by pid 44072 [verify typecheck (ptah-extension-vscode,ptah-cli,ptah-tui)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T18:52:33.734Z; pid 31256 [verify test (@ptah-extension/agent-sdk)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T18:53:22.168Z (queue position 1)
[verify 2026-10-30T18:53:40.359Z] lock slot 1 acquired after 19s: verify lint,test,typecheck (@ptah-extension/lane-outcomes)

 NX   3 tasks: 3 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      58.8s
  Cache:             0/3 hit (0%)
  Critical path:     39.6s (1 task)
  Recoverable time:  19.2s (33% of the run)

  Recommendations:
    - Increase parallelism to recover up to 19.2s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team in CI → https://cloud.nx.app/connect/7CAe6oXzb9.
[verify 2026-10-30T18:54:48.327Z] lock released after 68.0s, exit code 0
```

## Production defects

None found by these cases. No production file was changed.

## Decisions

- Migration test seam: used registered 0054 and 0064 SQL against real SQLite; those are the migrations affecting this table, and persistence-sqlite separately checks 0064 registration. Reversible: yes.
- Guard coverage: included a null kind with mapped source to pin the protection against overwriting provenance. Reversible: yes.
- Skill discovery: no skill mechanism or matching skill was exposed in this lane; no skill was loaded.
