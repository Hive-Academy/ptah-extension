## Summary

Scorecard ground truth now accepts the method `model-panel`, and that method requires a non-empty `panel`. A suite may carry an optional `displayLabel` (1–80 characters). The markdown writer prints that label as an extra heading when it is set and leaves the markdown byte-identical when it is absent. `schemaVersion` stays `1`.

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\suite-kinds.ts
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\suite-kinds.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-620-request-report.md

## Criteria met

1. One exported `as const` array, `GROUND_TRUTH_METHODS`, includes `'model-panel'` (`suite-kinds.ts:5-11`). `GroundTruthMethod` is `(typeof GROUND_TRUTH_METHODS)[number]` (`suite-kinds.ts:12`). `groundTruthSchema` uses `z.enum(GROUND_TRUTH_METHODS)` (`scorecard.types.ts:33`). `SuiteView.groundTruth.method` is `GroundTruthMethod` (`suite-kinds.ts:27`). The array lives in `suite-kinds.ts` so the import direction stays acyclic; see Decisions.
2. `panel` is `z.string().min(1).optional()` (`scorecard.types.ts:34`) and `panel?: string` on the view (`suite-kinds.ts:29`). `superRefine` requires `panel` when `method` is `model-panel` and rejects `panel` for every other method (`scorecard.types.ts:38-50`).
3. `displayLabel` is `z.string().min(1).max(80).optional()` on the suite entry (`scorecard.types.ts:73`) and `displayLabel?: string` on `SuiteView` (`suite-kinds.ts:17`). The writer inserts `## ${cell(displayLabel)} (${kind})` only when the label is present (`scorecard-writers.ts:87-89`). `cell` is the same escape used for other user text (`scorecard-writers.ts:147`). Kind stays visible in that heading and in the existing kind or tool heading.
4. `schemaVersion` is still `z.literal(1)` (`scorecard.types.ts:260`). No other writer or validation behavior changed.
5. `scorecard.types.spec.ts:141-191` accepts `model-panel` with `panel`, rejects `model-panel` without `panel`, rejects `panel` on `seeded`, rejects `displayLabel` of length 0 and 81, and accepts length 80. `suite-kinds.spec.ts:51-80` asserts the shared method list and a `SuiteView` carrying `model-panel`, `panel`, and an 80-character `displayLabel`. `scorecard-writers.spec.ts:231-241` expects the escaped heading `## Search \| symbols<br>panel (retrieval)` and asserts `renderScorecardMarkdown` is byte-identical after the label is removed.

## Checks run

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/scorecard --coverage=false --maxWorkers=2`

```
PASS   mcp-bench  tools/mcp-bench/src/scorecard/scorecard-writers.spec.ts (15.347 s)
PASS   mcp-bench  tools/mcp-bench/src/scorecard/scorecard.types.spec.ts
PASS   mcp-bench  tools/mcp-bench/src/scorecard/suite-kinds.spec.ts

Test Suites: 3 passed, 3 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        17.633 s
Ran all test suites matching tools/mcp-bench/src/scorecard.
```

`npx nx typecheck mcp-bench --parallel=1`

```
> nx run mcp-bench:typecheck

> tsc --noEmit --project tools/mcp-bench/tsconfig.json

NX   Successfully ran target typecheck for project mcp-bench
```

`npx prettier --check` on the six scorecard files failed once on `scorecard.types.ts` (line wrap only). `npx prettier --write tools/mcp-bench/src/scorecard/scorecard.types.ts` rewrapped two `if` conditions. The check was then run again:

`npx prettier --check tools/mcp-bench/src/scorecard/scorecard.types.ts tools/mcp-bench/src/scorecard/suite-kinds.ts tools/mcp-bench/src/scorecard/scorecard-writers.ts tools/mcp-bench/src/scorecard/scorecard.types.spec.ts tools/mcp-bench/src/scorecard/suite-kinds.spec.ts tools/mcp-bench/src/scorecard/scorecard-writers.spec.ts`

```
Checking formatting...
All matched files use Prettier code style!
```

Jest and typecheck ran before that whitespace-only wrap. Scoped `ptah_get_diagnostics` on the three source files after the wrap reported 0 errors.

## Decisions

- `GROUND_TRUTH_METHODS` is exported from `suite-kinds.ts`, not `scorecard.types.ts`. `scorecard.types.ts` already value-imports `SuiteView` and the registry from `suite-kinds.ts`. `suite-kinds.ts` does not import `scorecard.types.ts`. Defining the array in `scorecard.types.ts` and importing the type back into `suite-kinds.ts` would cycle. `scorecard.types.ts` imports the array and passes it to `z.enum`.
- `model-panel` requires `panel`. Omitting it fails with `model-panel ground truth requires panel`. A present `panel` with any other method fails with `panel is only valid for model-panel ground truth`. `panel` must have length at least 1. It is not trimmed.
- The label heading is inserted in the shared suite block, before the kind renderer, so retrieval suites (which render their own `## tool` heading) still show it. Absent `displayLabel` adds no lines, so existing markdown stays byte-identical. The label goes through `cell()` (`|` to `\|`, newlines to `<br>`). The kind is left unescaped, matching the existing `## ${suite.kind}` heading.

## Not done

- `tools/mcp-bench/src/suites/question-sets.ts` still has its own `z.enum(['generated', 'labelled', 'seeded', 'git-history'])`. Updating it is outside the six-file scope.
- No commit, push, or git mutation.
- Jest and `nx typecheck` were not re-run after the Prettier wrap. The wrap only changed line breaks in `scorecard.types.ts`.

## Revision 1

### 1. SERIOUS — `model-panel` could not enter through frozen question sets

`questionEnvelopeSchema.method` is `z.enum(GROUND_TRUTH_METHODS)` (`tools/mcp-bench/src/suites/question-sets.ts:37`) and `panel` is `z.string().min(1).optional()` (`question-sets.ts:38`). The same rule as the scorecard is `refineGroundTruthPanel` (`tools/mcp-bench/src/scorecard/suite-kinds.ts:15-31`), called from the envelope (`question-sets.ts:51-53`) and from `groundTruthSchema` (`scorecard.types.ts:39-41`). `GroundTruthRef.method` is `GroundTruthMethod` and `panel` is optional (`question-sets.ts:142-145`). `toSet` copies `panel` onto that ref when it is present (`question-sets.ts:218-229`).

Copy sites checked, not edited, because they already pass the object through:

- `tools/mcp-bench/src/suites/tool-suites.ts` assigns `groundTruth: set.groundTruth` (same object; `panel` stays).
- `tools/mcp-bench/src/suites/suite-runner.ts:682` builds the suite with `groundTruth: { ...definition.groundTruth }`, which copies `panel`.

Tests added in `tools/mcp-bench/src/suites/question-sets.spec.ts` (file was absent): a `model-panel` envelope with `panel` parses and `toSet` puts `panel` on `GroundTruthRef` (`question-sets.spec.ts:21-44`); `model-panel` without `panel` is rejected (`question-sets.spec.ts:46-54`); `panel` on `seeded` is rejected (`question-sets.spec.ts:55-62`).

### 2. MODERATE — a lone CR in `displayLabel` could forge a heading

Choice: collapse line breaks to a space in the heading, and do not reject CR/LF in the `displayLabel` schema. The writer spec renders the label, so a schema rejection would throw instead of showing the heading. `headingCell` (`scorecard-writers.ts:147-149`) turns `\r\n`, `\r`, and `\n` into a space, then `cell` escapes `|`. `cell` (`scorecard-writers.ts:150-152`) now maps those same breaks to `<br>` so a table cell cannot split on a lone CR; table LF output stays `<br>`. An LF label that used to render as `symbols<br>panel` now renders as `symbols panel`.

Spec: `scorecard-writers.spec.ts:234-244` expects `## Search \| symbols panel (retrieval)` for an LF label, and `## safe ## forged (retrieval)` for `safe\r## forged`, with no line that starts with `## forged`.

### Checks run

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/scorecard tools/mcp-bench/src/suites --coverage=false --maxWorkers=2` (with `RG_PATH` set to the worktree's ripgrep binary), then again after the Prettier wrap:

```
Test Suites: 5 passed, 5 total
Tests:       43 passed, 43 total
Time:        14.742 s, estimated 17 s
Ran all test suites matching tools/mcp-bench/src/scorecard|tools/mcp-bench/src/suites.
```

`npx nx typecheck mcp-bench --parallel=1` (before and after the Prettier wrap):

```
NX   Successfully ran target typecheck for project mcp-bench
```

`npx nx lint mcp-bench --parallel=1` (before the wrap; the wrap was spec-only):

```
✖ 2 problems (0 errors, 2 warnings)
NX   Successfully ran target lint for project mcp-bench
```

The two warnings are existing and outside this change (`scip-cross-check.ts` max-lines, an unused eslint-disable in `bench-host-process.spec.ts`).

`npx prettier --check` on the six files touched in this revision passed after `prettier --write` rewrapped `scorecard-writers.spec.ts`:

```
All matched files use Prettier code style!
```

### Not done in this revision

Per-question file schemas under `tools/mcp-bench/src/ground-truth/` still declare their own method enums. `loadQuestionBank` parses relevance, memory, and file-tools through those schemas after the envelope. A `model-panel` file of those kinds would fail that second parse. Those files are outside the allowed set. `retrieval-suite-kind.ts` has a separate `cell` that still uses `\r?\n`; display labels do not go through it.
