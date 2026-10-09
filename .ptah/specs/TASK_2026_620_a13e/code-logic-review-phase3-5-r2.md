# Phase 3.5 code-logic review — round 2

Reviewed commit `91f3b73e7`, the Batch 17–20 reports, plan validation/execution, and the scoped memory-skills test command. The five reported fixes close the original defects, but Batch 18 still turns a duplicated private write loop into product pass/fail evidence.

## Original-finding status

| Prior finding | Batch | Status | Evidence |
|---|---:|---|---|
| The commit path persisted the input draft instead of the resolver result | 18 | CLOSED | `commitDrafts` iterates `resolved`, strips only `mergeTargetId`, appends resolved content, and passes the resolved draft to `insertRow` at `tools/mcp-bench/src/memory-skills/suites/memory/merge-update-pass.ts:229-257`. The adapter maps every product insert field at `merge-update-ports.ts:275-301`, matching `libs/backend/memory-curator/src/lib/memory-curator.service.ts:860-889`. The per-draft `try/catch` also matches the product's skip-and-continue at `memory-curator.service.ts:825-897`. |
| Rerank used a reconstructed no-rerank baseline | 18 | CLOSED | The unavailable baseline is null and the suite is unconditionally `na` at `tools/mcp-bench/src/memory-skills/suites/memory/dedup.suite.ts:618-654`; the report records the reason and limitation at `.ptah/specs/TASK_2026_620_a13e/batch-18-report.md:260-274`. |
| Scripted/private liveness harness emitted product pass/fail | 17 | CLOSED | Both liveness paths force `verdict: 'na'` at `tools/mcp-bench/src/memory-skills/suites/memory/liveness.suite.ts:464-472` and `:605-633`. The report explicitly calls them harness-only at `.ptah/specs/TASK_2026_620_a13e/batch-17-report.md:340-361`. |
| Scope-write ordering was only documented | 19 | CLOSED | The suite declares `first` and changes to `na` on existing rows at `tools/mcp-bench/src/memory-skills/suites/memory/scope-write.suite.ts:393-395,424,514-521,549-557`. Both runner and host-plan schemas reject bad ordering and duplicate ids at `runner/runner-plan.ts:75-103` and `host/plan.schema.ts:248-261`; the executor rechecks registered declarations before running suites (`host/memory-skills-host.ts:183-199`). |
| Retention ordering was only documented | 20 | CLOSED | The three destructive suites are `last` in `tools/mcp-bench/src/memory-skills/host/suite-placement.ts:24-32`; any non-`last` suite after the first is rejected at `:47-69`. This keeps snapshot audits before retention. The rule is unit-tested, including a run of last suites, at `host/suite-placement.spec.ts:18-55`. |

## New findings

1. **[serious] Batch 18 — mirrored private commit code still emits product pass/fail verdicts.** `commitDrafts` is expressly a mirror because the actual private `MemoryCuratorService.doCurate` cannot be invoked (`tools/mcp-bench/src/memory-skills/suites/memory/merge-update-pass.ts:194-201`). Although the present copy faithfully includes the listed fields and failed-write behaviour, it is not the SUT's commit path; a future product-only change can make its successful result diverge. The report discloses exactly that drift risk (`.ptah/specs/TASK_2026_620_a13e/batch-18-report.md:233-258`), but `mem.dedup`, `mem.update`, and `mem.temporal` can still return `pass` or `fail` (`dedup.suite.ts:459-469`, `update.suite.ts:367-377,596-606`). Under the benchmark rule, these results must be `na` (or be split so the actual public product curation path is measured) while the mirror remains. The existing disclosure makes the limitation visible, but not the verdict honest.

## Per-suite assessment

“Partly” means that a meaningful portion uses the product, but the score or write result also depends on a harness/mirrored path. “Honest” means the current verdict is compatible with that evidence limitation.

| Suite id | Real product path? | Verdict honest? |
|---|---|---|
| `mem.extraction` | yes | yes |
| `mem.liveness.fault` | no | yes |
| `mem.liveness.rescan` | no | yes |
| `mem.dedup` | partly | no |
| `mem.dedup.rerank` | yes | yes |
| `mem.update` | partly | no |
| `mem.temporal` | partly | no |
| `mem.update.seed` | yes | yes |
| `mem.search.fts-and` | yes | yes |
| `mem.injection.recall` | yes | yes |
| `mem.abstention` | yes | yes |
| `mem.scope.write` | yes | yes |
| `mem.retention.lifecycle` | yes | yes |
| `mem.retention.growth` | yes | yes |
| `mem.ranking.roster` | yes | yes |
| `mem.liveness.audit` | yes | yes |
| `skill.backlog.audit` | yes | yes |

## Additional checks

- The host-only import guard remains meaningful after allowing host-only modules to import one another: only listed modules may value-import the curator barrel and a non-host, non-host-only module still cannot value-import any host-only module (`tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts:19-32,78-100`).
- Placement has no reviewed runner/host bypass: both schemas reject duplicate ids, the parent uses the shared placement table, and the host revalidates against the runtime registry. `last` suites may follow one another by design; snapshot audits (`any`) cannot follow them. No separate placement is warranted for `mem.update.seed`: it uses its own suite scope and does not claim a fresh whole database.
- Scoped Jest command attempted: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand 2>&1 | grep -E "^Tests:"`. In this PowerShell image `grep` is unavailable, so no `Tests:` line was produced. The same scoped command with a PowerShell line filter produced no observable `Tests:` line before the command returned; no broader or benchmark command was run.

## Verdict

**REVISE** — make the three Batch 18 mirrored-commit suites `na`, or replace the mirror with a public product seam and then restore scored verdicts.
