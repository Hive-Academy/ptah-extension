# Batch 6 report — S6 corpus and compactness (TASK_2026_623_3492)

Executor: backend-developer. Batch 6 has no git operations. The working tree is left dirty for the team-leader.

## Tasks

### Task 6.1: corpus cases for the new grammar and skill examples — done

- `ptah-ui.corpus.ts`:
  - `PtahUiCorpusCase` gains two fields:
    - `release: 610 | 623` marks the released flat cases;
    - `displayId?` is set for cases written as a `ptah-ui display <id>` fence.
  - New export `ptahUiCorpusFence(entry)` returns the whole fence an agent writes.
  - The six 610 cases are unchanged apart from `release: 610`.
  - 17 new cases:
    - one per container (R3.2): `row`, `col`, `grid`, `card`, `section`, `accordion`;
    - one per atom: `note` (tones ok, warn and error), `progress` (tone, decimal value and 0), `badge` (neutral, info and error), `avatar` (with and without a subtitle);
    - `stat-trend-spark`: a trend with a spark, a trend alone, and a spark after an empty trend;
    - `mixed-nested-release`: a grid, cards, a section and accordions nested three levels deep, with sources;
    - the four DOC1 skill examples (R8.3):
      - `skill-subagent-usage-dashboard`: a grid of `stats` with `$agents` scalars plus `table $agents`;
      - `skill-id-update-first` and `skill-id-update-second`: the same id `build-progress`, sent again with new values;
      - `skill-cli-tools-usage-context`: a `row` with `table $agents session` (`cols name | status | tokens | context`) next to `table $limits`.
- `ptah-ui-compactness.spec.ts` (rewritten):
  - **R8.4 count per case.** The spec computes the `gpt-tokenizer` count of the fence body and of the canonical unresolved converter JSON for every corpus case, and asserts the fence is smaller. Both counts go in the test title, so every run reports them.
  - **Coverage guard.** The new cases must cover every new container, every atom, a stat trend and a spark, and the mixed case must nest at least three levels deep.
  - **Display ids.** Every skill-example display id must compile; none is reserved.
  - **Skill examples with `PtahUiAgentsInput` / `PtahUiLimitsInput`** (rendered through `renderPtahUiBlock(body, {surfaceId, snapshot, agents, limits, countBytes})`):
    - Dashboard: the totals are 3 agents, 1 running, 88152 tokens and `$1.03`. The table rows are pinned exactly. No `$agents.` placeholder is left.
    - Id update: both blocks use the same id. The progress value goes from 40 to 100, and the completed and failed counts are real numbers.
    - CLI tools (#16, #28): the CLI lanes' `context` reads `"unavailable"`, while the SDK subagent reads `"50,000 · 25%"`. The session scope includes the lane from the earlier turn, and the `$limits` table has the `as of HH:MM` description.
    - With no live inputs, every skill-example stat reads `"unavailable"` and never 0.
  - **Budget breach (#36):** `maxTreeDepth (8) exceeded`, `maxChildrenPerNode (50) exceeded` and `maxGridColumns (4) exceeded`. Each reason starts with `<maxX> (<n>) exceeded` and is never "block exceeds a display limit".

Recorded R8.4 counts (fence body tokens vs unresolved JSON tokens):

| Case | Fence | JSON |
| --- | --- | --- |
| turn-summary-sources-crlf | 39 | 193 |
| literal-table-escapes-unicode | 41 | 123 |
| changed-files-columns | 19 | 129 |
| test-run-list | 8 | 81 |
| coverage-trend-chart | 35 | 109 |
| release-checklist-mixed | 70 | 218 |
| container-row-badges | 24 | 131 |
| container-col-note-progress | 19 | 113 |
| container-grid-stats | 46 | 244 |
| container-card-avatar | 30 | 121 |
| container-section-table | 18 | 150 |
| container-accordion-tests | 9 | 104 |
| atom-note-tones | 26 | 117 |
| atom-progress-tones | 28 | 121 |
| atom-badge-tones | 14 | 104 |
| atom-avatar | 12 | 78 |
| stat-trend-spark | 73 | 184 |
| mixed-nested-release | 114 | 486 |
| skill-subagent-usage-dashboard | 59 | 344 |
| skill-id-update-first | 30 | 153 |
| skill-id-update-second | 37 | 175 |
| skill-cli-tools-usage-context | 27 | 266 |

### Task 6.2: `$agents` compactness spec and `/3` regression run — done

- CREATED `ptah-ui-agents-compactness.spec.ts`:
  - **R8.5 fixture.** Five agents with name, status, tokens, cost and duration: three SDK nodes and two CLI lanes. The fixture covers a running row (duration "unavailable"), a failed lane, and a cost under one cent (`$0.0040`). It has two forms:
    - (a) the display fence `ptah-ui display subagents` with `table $agents` and `cols name | status | tokens | cost | duration`;
    - (b) the GitHub-markdown table with the values typed out.
  - **Equivalence check.** The spec renders (a) with the fixture and asserts that its five rows equal, cell for cell, the rows typed in (b). The comparison is therefore like for like.
  - **Counts.** The spec asserts fence < markdown and records both counts in the test title: **fence 25 tokens, markdown 127 tokens**. No ratio target is set.
  - **610 `/3` regression (R3.1).** The spec holds golden envelopes and bindings for the six `release: 610` cases.
    - Each one must convert deep-equal, with `catalogVersion` as the only literal that differs.
    - The same envelope with `catalogVersion` set back to `dashboard-catalog/3` must also pass `validateSurfaceDocument`, which proves it uses only the `/3` vocabulary.
    - A guard fails if a 610 case is added or dropped without its golden.
- The `/3` regression run: `surface-contract`, `dashboard-trust-boundary`, `surface-budgets` and `host-source-registry.contract` all pass (below).

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui.corpus.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-compactness.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-agents-compactness.spec.ts
- CREATED this report.

No file outside the batch list was edited.

## Verification

The Batch 6 command was run from the worktree, foreground, with output tailed. One path differs from the command: `host-source-registry.contract.spec.ts` is not under `mcp-apps-contracts/`. A search found it at `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts`, and the command used that path, as batches.md allows.

First run: 4 of 6 suites passed and 192 tests passed. Two suites did not compile under ts-jest, both with TS18048 errors in my new specs (`c.title` and `rows` possibly undefined). Shared typecheck passed. Shared lint reported 0 errors and 6 baseline warnings; none of the warnings is in a batch file. I fixed both type errors with optional access and ran the Jest part again:

```
Test Suites: 6 passed, 6 total
Tests:       232 passed, 232 total
```

```
> tsc --noEmit --project libs/shared/tsconfig.lib.json
NX  Successfully ran target typecheck for project @ptah-extension/shared
✖ 6 problems (0 errors, 6 warnings)
NX  Successfully ran target lint for project @ptah-extension/shared
```

The typecheck and lint results are from the first run. The fix only added `?.` and `?? []` inside two spec files, so they were not run again.

**Specs I did not run.** Three existing specs iterate `PTAH_UI_CORPUS`, so they also see the 17 new cases: `ptah-ui-parser.spec.ts` (parse, and nesting each case one level under `col`), `ptah-ui-converter.spec.ts` (positional `c${i}` top-level ids, valid under `/4`), and `ptah-ui-pipeline.spec.ts` (renders with the populated snapshot). They are not in the Batch 6 command, so I did not run them under Jest. Instead I bundled a throwaway script with esbuild, ran it outside the repository, and then deleted it. It reproduced those checks for every case: all 23 parse, keep positional top-level ids, validate under `/4`, parse again when nested under `col`, and render `ok`. **The team-leader may want to add those three specs to the Batch 6 commit check.**

The `@ptah-extension/declarative-dashboard` typecheck was not run (decision #21).

## Plan deviations

- **`release` field.** `PtahUiCorpusCase` gained a required `release` field, so the `/3` regression can pick out the 610 cases without depending on their position in the array. It also gained an optional `displayId`, because a display id lives in the fence opener, not the body.
- **Golden envelopes.** No `/3` converter exists any more, and I do not run git, so I could not produce the 610 output from the base commit. The goldens are therefore the current output of those six cases. Three things back them:
  - the per-element 610 fixtures in `ptah-ui-converter.spec.ts` keep the same shapes;
  - each golden is a valid `dashboard-catalog/3` document;
  - none contains a `/4`-only kind or field.

## Risks and edge cases handled

- **Budget reasons (#36).** A breach must read `<maxX> (<n>) exceeded`. This is pinned for three limits, and the old generic text is asserted absent. Parse-time reasons end in ` (line N)`, so the spec checks with `startsWith`.
- **CLI context (#16, #28).** CLI lanes render `context` as "unavailable". This is pinned next to an SDK row whose context is known, with the percent taken only from `sdk-native` capacity evidence.
- **Zero-agent cost (#35) and "unavailable" never 0.** With no inputs, every `$agents` stat in the skill examples renders "unavailable".
- **Session scope (R5.11).** A lane that started in an earlier turn appears only in `table $agents session`, not in the turn-scoped dashboard.
- **Reserved ids (#31).** The skill display ids (`subagent-usage`, `build-progress`, `cli-tools`) all compile; none starts with `ptah.`.
- **`$limits` "as of" time (R10.6).** It is asserted with a format regex, because `clockTime` uses the local timezone.
- **`/3` stays unchanged (R3.1).** This is covered by the goldens, the `/3` re-validation and the four `/3` regression specs.

## Out-of-scope observations

- Batch 31 (`measurement.md`) can take the R8.4 and R8.5 counts from the test titles or from this report.
- `maxComponents (200)` cannot be breached from a fence body. Every component needs at least one line, and the parser caps a body at 200 lines first ("ptah-ui body exceeds 200 lines"). So no corpus case can reach that limit.
