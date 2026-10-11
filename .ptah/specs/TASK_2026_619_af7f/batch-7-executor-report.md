# Batch 7 executor report — Task 7.1: SCIP cross-check ground truth (polyglot corpora)

## Work completed

- `tools/mcp-bench/src/ground-truth/scip-cross-check.ts` (new): a SCIP-based cross-check ground-truth generator. SCIP is benchmark ground truth only, never a runtime backend (context.md Gate SR decisions 1 and 4); nothing outside `tools/mcp-bench` imports it and it never runs an indexer.
  - Hand-written protobuf decoder for the pinned subset of `scip.proto` (verified against upstream `scip-code/scip` `scip.proto`: `Index{metadata=1, documents=2, external_symbols=3}`, `Document{relative_path=1, occurrences=2, symbols=3, language=4}`, `Occurrence{range=1 packed int32, symbol=2, symbol_roles=3}`, `SymbolInformation{symbol=1}`, `SymbolRole.Definition=0x1`, `SymbolRole.Import=0x2`). Varint, length-delimited, packed int32 and non-packed int32, fixed32/fixed64 skipping, and group skipping are implemented; unknown fields are skipped by wire type. No new dependency; `@scip-code/scip` (ESM-only) is not used. Only the deprecated packed `range` field (1) is decoded per the pinned subset — if a future index emits only the newer `typed_range` oneof (fields 8/9), `parseOccurrence` fails with a clear `SCIP occurrence without a range` error instead of silently producing empty truth.
  - `parseScipIndex`, `detectScipIndexers`, `generatePolyglotQuestions`, `compareWithTsTruth`, `naRecord`, `writePolyglotQuestions`, `symbolName` (SCIP symbol-string descriptor-name extraction per the `Symbol` grammar: `` `foo`(). ``, `foo#`, `foo.`, `foo/`, `foo:`, `foo!`, parameters/type-parameters, and container-descriptor chains like `logrus/Info` / `Foo#field`), plus the envelope zod schemas next to the generator (accepted short-lived duplication; Task 9.1 merges schemas).
  - Reference questions: global (non-`local `) symbols with a definition occurrence in the corpus; truth = all occurrences `file:line` including the definition (`declarationIncluded: true`); stratified under-5 / 5-50 / over-50 (targets 17/17/16, Batch 5's equal thirds scaled to 50). Unfilled strata are recorded in `counts` (per-stratum selected + `-target` keys and `unfilled-strata`), never thrown.
  - Dependency questions: file-level edges (file A depends on file B when A has a non-definition occurrence of a symbol whose definition occurrence is in B, B ≠ A); truth sets sorted workspace-relative paths, `pathForms: ['relative','absolute']`; import-role occurrences create edges.
  - Selection is seeded with `mulberry32` from `ts-program.ts`.
- `tools/mcp-bench/src/ground-truth/scip-cross-check.spec.ts` (new): spec-only minimal protobuf **encoder** building a 3-document index (a.py defines `f` and `h`; b.py references `f` twice, imports `h`, references a `local g`; c.py defines `local g` and carries a symbol-less occurrence). 11 tests cover: parse round trip (1-based lines from 3- and 4-element ranges and non-packed field-1 entries, definition/import roles, language/symbols, symbol-less occurrences dropped, unknown fields skipped at index/document/occurrence levels), `symbolName` descriptor forms, reference truth for `f` including the definition, dependents of a.py = [b.py] and no edge from b.py to c.py via the local symbol, unfilled strata recorded not thrown, pretty-JSON write with trailing newline, `detectScipIndexers` with injected `which` (absent → unavailable with reason; PATH lookup; env override found and unresolvable), `naRecord` shape validated by the schema, and `compareWithTsTruth` on exact/partial/unmatched questions.
- `tools/mcp-bench/corpus.config.json` (edited): added the `polyglot` key with the two pinned MIT corpora — `python-attrs` (tag 25.4.0, commit `9a98e00a7c078360add417c5d62db820d4645ab1`) and `go-logrus` (tag v1.9.4, commit `b61f268f75b6ff134a62cd62aee1095fa12e8d2e`). The reader (`src/corpus/corpus.ts`) uses non-strict `z.object`, so the new key is stripped from its type and changes nothing for existing flows.

## API for the orchestrator

Exact signatures (all exported from `tools/mcp-bench/src/ground-truth/scip-cross-check.ts`):

```ts
parseScipIndex(buffer: Uint8Array): ScipIndex
// ScipIndex { documents: ScipDocument[] }
// ScipDocument { relativePath; language; symbols: string[]; occurrences: ScipOccurrence[] }
// ScipOccurrence { line (1-based); symbol; isDefinition; isImport }

detectScipIndexers(
  env: Record<string, string | undefined> = process.env,
  which: (command: string) => string | null = defaultWhich,
): Record<'typescript' | 'python' | 'go', { available: boolean; command: string | null; reason: string | null }>
// PATH lookup plus overrides PTAH_BENCH_SCIP_TYPESCRIPT / PTAH_BENCH_SCIP_PYTHON /
// PTAH_BENCH_SCIP_GO (a path or command string). Detection is only for the `na` record.

generatePolyglotQuestions(
  index: ScipIndex,
  options: { corpusId: string; corpusCommit: string; language: string; frozenAt: string; seed: number },
): ScipEnvelope
// Envelope { id: corpusId, language, version: '1', method: 'generated', frozenAt, corpusCommit,
//   generator: 'scip-cross-check.ts', seed, counts, questions } — questions holds both kinds:
//   reference-N: { id, query, file, line, truth: 'file:line'[] (incl. definition), declarationIncluded: true, stratum }
//   dependency-N: { id, file, pathForms: ['relative','absolute'], dependencies, dependents, imports } (sorted)
// counts keys: under-5, 5-50, over-50 (+ '<stratum>-target' each), references, references-target,
//   unfilled-strata, dependencies, dependencies-target.

compareWithTsTruth(
  index: ScipIndex,
  tsReferences: { questions: { id: string; query: string; file: string; line: number; truth: readonly string[] }[] },
): { compared: number; unmatched: number; meanJaccard: number; exactRate: number;
     perQuestion: { id: string; jaccard: number; onlyTs: number; onlyScip: number }[] }
// Input is the parsed tools/mcp-bench/questions/7910f34cf/references.json (structural subset).
// meanJaccard/exactRate cover the compared questions; unmatched counts questions with no
// matching SCIP occurrence name at file:line.

naRecord(language: string, reason: string): ScipNaEnvelope
// { id: language, language, version: '1', method: 'generated', frozenAt: <now>, corpusCommit: '',
//   generator: 'scip-cross-check.ts', seed: 0, counts: {}, questions: [], na: { reason } }

writePolyglotQuestions(outputDirectory: string, name: string, envelope: ScipEnvelope | ScipNaEnvelope): void
// pretty JSON + trailing newline at <outputDirectory>/<name>.json

symbolName(symbol: string): string
```

Proposed flow and output names under `tools/mcp-bench/questions/` (the orchestrator runs the indexers — many minutes, scip-python only inside WSL, scip-go possibly at `%USERPROFILE%\go\bin` via `PTAH_BENCH_SCIP_GO`):

1. `detectScipIndexers()` once; for each absent language write `naRecord(language, reason)` via `writePolyglotQuestions('tools/mcp-bench/questions/scip', `${language}-na`, record)` → `questions/scip/python-na.json`, `questions/scip/go-na.json` (envelope `id` = language).
2. For each `polyglot` entry in `corpus.config.json`: check out the pinned `commit`, run the language's indexer to `index.scip`, then `parseScipIndex(new Uint8Array(readFileSync(indexPath)))` (a Node `Buffer` is a `Uint8Array`) and `generatePolyglotQuestions(index, { corpusId: entry.id, corpusCommit: entry.commit, language: entry.language, frozenAt, seed })`. Seeds are the orchestrator's choice and are recorded in the envelope (e.g. 6190701 / 6190702).
3. Write with `writePolyglotQuestions('tools/mcp-bench/questions/scip', entry.id, envelope)` → `tools/mcp-bench/questions/scip/python-attrs.json`, `tools/mcp-bench/questions/scip/go-logrus.json`.
4. For the agreement report: index the monorepo TS corpus with scip-typescript, `parseScipIndex(...)`, `compareWithTsTruth(scipIndex, JSON.parse(readFileSync('tools/mcp-bench/questions/7910f34cf/references.json', 'utf8')))` and record the returned numbers (agreement rate per Batch 7 quality requirements).

## Files written

- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\scip-cross-check.ts (new)
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\scip-cross-check.spec.ts (new)
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\corpus.config.json (edited: added `polyglot` only, +19/−1)
- D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-7-executor-report.md (this report)

Changes I did NOT make (pre-existing in `git status`, left untouched): `.ptah/specs/TASK_2026_619_af7f/batch-6-executor-report.md`, `.ptah/specs/TASK_2026_619_af7f/batches.md`, `.ptah/specs/TASK_2026_619_af7f/handoff.md`.

## Verification

Run in the worktree root, scoped to the changed files only:

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/ground-truth/scip-cross-check.spec.ts`
  → `PASS mcp-bench tools/mcp-bench/src/ground-truth/scip-cross-check.spec.ts` — `Test Suites: 1 passed, Tests: 11 passed, 11 total`, exit 0 (re-run after formatting; identical result before).
- `npx eslint tools/mcp-bench/src/ground-truth/scip-cross-check.ts tools/mcp-bench/src/ground-truth/scip-cross-check.spec.ts`
  → no output, exit 0. (One `max-lines` warning, 701/700, appeared before formatting and is gone after `prettier --write` reflowed the file.)
- `npx prettier --write tools/mcp-bench/src/ground-truth/scip-cross-check.ts tools/mcp-bench/src/ground-truth/scip-cross-check.spec.ts tools/mcp-bench/corpus.config.json`
  → all three formatted; `corpus.config.json` reported `(unchanged)`.

Not run (per instructions): the full `nx run-many` gate, any SCIP indexer, and any corpus generation — those are the orchestrator's steps. No Batch 5/6 file, `corpus.ts`, `project.json` or `package.json` was touched.

## Deviations

1. `compareWithTsTruth` spec fixture uses 3 questions (exact, partial, unmatched) rather than the task's "2-question fixture": the three named outcomes (jaccard 1, expected fraction, unmatched counted) cannot fit in two questions, so all three are asserted explicitly.
2. The generated envelope carries one extra field, `language` (next to `corpusCommit`), with `id` = `corpusId`: the task's options require a `language` and a benchmark set must be machine-readable per language. `naRecord(language, reason)` — whose pinned signature has no corpus identity — uses `id` = `language`, `corpusCommit: ''`, `seed: 0`, `frozenAt: <now>`; the na schema relaxes `corpusCommit` to `z.string()`.
3. `ScipDocument` exposes parsed `language` and `symbols` beyond the required `relativePath`/`occurrences` (both are in the pinned protobuf subset; trivial cost, asserted in the spec).
4. Reference strata targets are 17/17/16 (Batch 5's equal thirds scaled to 50) and dependency questions are selected by seeded shuffle over all documents with no strata — the batch pins stratification for references only. Both choices are recorded in `counts` (`-target` keys per stratum, `unfilled-strata`).
5. `scip-go` being off PATH and `scip-python` being WSL-only were not worked around in code: `detectScipIndexers` reports them (with the `PTAH_BENCH_SCIP_*` override hint) and `naRecord` covers absence; running the indexers is the orchestrator's step.

## Orchestrator generation and corrections (2026-10-07)

- Indexers (installed globally by user decision, context.md): scip-typescript 0.4.0 (Windows, `tsconfig.scip.json` in the `%TEMP%\mcp-bench-b5-corpus` extract that includes `libs|apps|tools/**/*.ts(x)`, 2 m 12 s, 268 MB index, 6,346 documents); scip-go 0.2.7 (Windows, logrus v1.9.4, 8 s, 37 documents); scip-python 0.6.6 (WSL Ubuntu-24.04 only, because it crashes on Windows at `new RegExp(path.sep)`; `--environment` file `[]` because WSL Python has no pip; attrs 25.4.0, 64 documents).
- Correction 1 (`scip-cross-check.ts` `parseDocument`): scip-typescript on win32 writes `\` in `relative_path`, so `compareWithTsTruth` matched 0 of 150. Paths are now normalized to `/`. New spec case "normalizes win32 separators in document paths" (12/12 pass).
- Outputs in `tools/mcp-bench/questions/scip/`:
  - `python-attrs.json`: 37 reference questions (under-5 17, 5-50 17, over-50 3 of 16: the corpus is small; recorded as `unfilled-strata: 1`, not refilled, the same rule as Batch 5 references) and 50 dependency questions. Seed 6190701.
  - `go-logrus.json`: 41 reference questions (over-50 7 of 16) and 37 dependency questions (the corpus has 37 documents). Seed 6190702.
  - `ts-agreement.json`: 148 of 150 Batch 5 reference questions compared, 2 unmatched, mean Jaccard 0.877, exact 0.750.
- Agreement analysis: in all 37 non-exact questions `onlyScip` is 0 (SCIP never finds a reference the TS truth misses). All differences (1,477 extra TS locations) are interface or inherited members in the over-50 stratum (`dispose`, `getDiagnostics`, `name`, `readFile`): the TS language service `findReferences` returns the member together with its implementations, as the editor's "Find All References" does; SCIP keeps each symbol separate. Batch 9 should score references against the TS truth (editor semantics, which the `ptah_lsp_references` claim names) and report the SCIP-strict set as a second view.
