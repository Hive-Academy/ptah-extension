# Batch 5 executor report

## Work completed

- Task 5.1: added a corpus-root parameterized TypeScript language-service loader, path-aware compiler options, eligible `libs/`, `apps/`, and `tools/` discovery, unresolved external-module counting, post-load heap/RSS capture, deterministic `mulberry32`, and symbol exact/concept/negative generators with zod envelope validation.
- Task 5.2: added language-service reference/definition truth and module-resolution dependency/dependent generation. Dependents declare `pathForms: ['relative', 'absolute']`; Batch 9 must join the absolute form to that run's fresh corpus root and try both forms because relative `filePath` previously errored.
- Added the tiny mkdtemp fixture spec. It covers deterministic RNG, exact/negative/concept output, JSDoc identifier removal, test-file exclusion, retention of `index.ts` and `*.module.ts`, and graph output shape/static/export-from/dynamic-import input.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\ts-program.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\symbol-questions.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\graph-questions.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\ground-truth.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\questions\7910f34cf\symbols-exact.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\questions\7910f34cf\symbols-concept.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\questions\7910f34cf\references.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\questions\7910f34cf\definitions.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\questions\7910f34cf\dependents.json`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-5-executor-report.md`

## Frozen-output status

All five provisional files currently quote `{}` counts and zero questions. This is a deliberate, reported deviation caused by runner termination, not a claim that strata were satisfied. The requested driver is `node --max-old-space-size=8192 <ts-node entry> --transpile-only -P tools/mcp-bench/tsconfig.json %TEMP%\b5-drive.ts <pinned corpus root> tools\mcp-bench\questions\7910f34cf`; the attempted equivalent command used `npx ts-node` and did not finish within 30 seconds. Memory/time therefore were not captured.

## Risk handling

- Same-name reference candidates retain semantic language-service references and record `sameName`; the >50 bucket selects 25 same-name candidates when the corpus supplies them.
- Test files are excluded at generator selection time, while `index.ts` and `*.module.ts` are deliberately retained.
- No `withPinnedCorpus` call was made, avoiding the concurrent prune race.
- Output paths use workspace-relative forward slashes.

## Verification

- Scoped TypeScript diagnostics: no diagnostics in the four Batch 5 source files.
- FOREIGN diagnostics: Batch 6 `file-tool-questions.ts:368,371,372` has three type errors; not modified.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/ground-truth/ground-truth.spec.ts --runInBand` and the combined prettier check were started, but the runner stopped the command at 30 seconds without output. Full Nx verification was not run after this blocker.

## Revision 1

- Defect 1: declaration collection now admits only functions, classes, class methods/properties/accessors, interfaces, type aliases, enums, and source-file/namespace variable statements. Parameters, function locals, property assignments, binding elements, import/export specifiers, type parameters, and enum members cannot enter truth. The fixture adds kept and excluded examples.
- Defect 2: exact questions include `truthCount`; declarations sharing a semantic overload symbol collapse to their first signature, while distinct real declarations retain every location.
- Defect 3: exported variable declarations now inspect their containing `VariableStatement` for `export`.
- Defect 4: concept filtering requires five words with three or more letters and retains at least 60% of the first-sentence words; matching markdown-code identifier content is removed. Fixture cases cover thin, removal-heavy, and backtick queries.
- Defect 5: references shuffle sources by seed, sample at most three eligible declaration identifiers per file, build same-name data from those declarations, and stop only once all requested strata are full or files are exhausted. Counts use separate `over-50-same-name` and `over-50-other` keys.
- Defect 6: definitions shuffle source files and now record the call-site identifier as `query`.
- Defect 7: dependency questions draw all non-test source files by 0, 1-10, and over-10 dependent strata, with fallback selection and counts for the achieved stratum.
- The orchestrator has completed pinned extraction/generation measurements and will regenerate frozen JSON after these code corrections.
- Revision verification: `npx prettier --write` and `npx eslint` over the four Batch 5 TypeScript files completed with no diagnostics. Generator, Jest, and Nx were intentionally not run in this 30-second lane.

## Orchestrator verification and corrections (2026-10-07)

- Extraction: `git archive 7910f34cf | tar -x` into `%TEMP%\mcp-bench-b5-corpus` (386 MB, 36 s), run by the orchestrator outside the lane.
- Generator: esbuild bundle of a throwaway driver, `node --max-old-space-size=8192`. Load 53-66 s, 6,346 files, 8,711 unresolved external-module diagnostics (the extract has no `node_modules`), heap 3.4 GB after load, peak RSS 6.5 GB, total 963 s.
- Correction 1 (`symbol-questions.ts` `containsIdentifierToken`): camelCase inside backticks was not split, so `` `exportedValue` `` stayed in a concept query. The lane's own spec case failed on it. Fixed with the same camel split as `removeIdentifierTokens`.
- Correction 2 (`graph-questions.ts` `definitionQuestions`): 22 of 150 definition truths pointed at the import line of an unresolved external package (`injectable`, `inject`, `expect`, `map`). Definitions of kind `alias` are now skipped. New spec case "skips call sites whose only definition is an unresolved external import".
- Final frozen counts (`tools/mcp-bench/questions/7910f34cf/`): symbols-exact small 100, large 100, largest-lib 100, negative 50; symbols-concept jsdoc 200; references under-5 50, 5-50 50, over-50-same-name 25, over-50-other 25; definitions 150 call sites; dependents zero 34, 1-10 33, over-10 33.
- Checks on the final files: 0 of 150 definition truths on an import line; every definition and exact-symbol truth line contains the queried name; `ground-truth.spec.ts` 6/6; `npx prettier --check tools/mcp-bench/src/ground-truth tools/mcp-bench/questions` clean; `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` passed (1 m 29 s).
