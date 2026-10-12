# Phase 3.5 code-logic review — round 3 (final)

Reviewed `d3aee70e1` and its Batch 18 report update. The remaining round-two finding is closed.

## Finding status

| Prior finding | Status | Evidence |
|---|---|---|
| Batch 18's mirrored private commit loop could emit product `pass`/`fail` verdicts. | CLOSED | `mem.dedup` computes a specific reason first and then falls back to `MIRRORED_COMMIT_NA` at `tools/mcp-bench/src/memory-skills/suites/memory/dedup.suite.ts:421-422`, while its verdict is the literal `'na'` at `:459-463`. `mem.update` does the same at `tools/mcp-bench/src/memory-skills/suites/memory/update.suite.ts:330-331,368-372`; `mem.temporal` does so at `:567-568,596-608`. No affected suite has a pass/fail verdict branch. |

The precedence is correct: `naReasonOf(...)` supplies a more specific failure/coverage reason (for example cassette miss or ground-truth below minimum) when one exists; only otherwise is `MIRRORED_COMMIT_NA` used. The suite tests pin both behaviours: a dedup cassette miss remains `cassette-miss` (`dedup.suite.spec.ts:274-300`) and the temporal normal case gets `MIRRORED_COMMIT_NA` (`update.suite.spec.ts:270-289`). The report accurately documents the permanent `na` policy and retained deltas at `.ptah/specs/TASK_2026_620_a13e/batch-18-report.md:233-258` and its Round 2 section.

`mem.update.seed` remains deliberately separate: it drives the product seeding path and can still score its invariant; its pass expectation is pinned at `tools/mcp-bench/src/memory-skills/suites/memory/update.suite.spec.ts:311-329`. No regression in that distinction was found.

## New findings

None.

## Final per-suite honesty assessment

| Suite id | Real product path? | Verdict honest? |
|---|---|---|
| `mem.extraction` | yes | yes |
| `mem.liveness.fault` | no | yes (`na`) |
| `mem.liveness.rescan` | no | yes (`na`) |
| `mem.dedup` | partly | yes (`na`) |
| `mem.dedup.rerank` | yes | yes (`na`) |
| `mem.update` | partly | yes (`na`) |
| `mem.temporal` | partly | yes (`na`) |
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

## Scoped Jest

Command issued (and no broader test, bench host, or benchmark command was run):

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand 2>&1 | Select-String -Pattern 'Tests:'`

`Tests:` line observed: **none** — the command returned no filtered output in this terminal session, so no test-count result is asserted here.

## Verdict

**APPROVED** — the final Batch 18 change makes the mirrored-path limitation explicit in both result semantics and reporting; all evidence-limited suites now return `na` rather than product pass/fail.
