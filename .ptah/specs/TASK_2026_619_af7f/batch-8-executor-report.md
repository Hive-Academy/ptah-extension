## Work completed

Implemented Batch 8 native baselines for all frozen benchmark suites. The runner resolves ripgrep from `RG_PATH` before a `where`/`which` PATH lookup, executes it through `execFile` without a shell, treats exit code 1 as an empty result, and normalizes JSON match paths.

The suite implementations cover exact and concept symbol search, references, definitions, dependents, relevance (including a `git-log` comparison view), whole-file AST read, glob, literal/regex text search, and the expected low-scoring memory comparison view. Results carry native output text, command count, latency, and an error field for Batch 9 metrics.

## API for the Batch 9 runner

```ts
export interface NativeResult {
  answer: Answer;
  commands: number;
  resultText: string;
  latencyMs: number;
  error: string | null;
  view?: string;
}

export interface NativeContext {
  corpusRoot: string;
  rg: RgRunner;
  git?: GitRunner;
  gitRoot?: string;
  corpusCommit?: string;
}

export function createRgRunner(executable?: string): RgRunner;
export function resolveRg(options?: ResolveRgOptions): string;
export function runRg(args: readonly string[], options: RgRunOptions): Promise<RgRunResult>;
export function parseRgJsonMatchLines(stdout: string, workspaceRoot: string): string[];

export function symbolsExactBaseline(question: SymbolQuestion, ctx: NativeContext): Promise<NativeResult>;
export function symbolsConceptBaseline(question: SymbolQuestion, ctx: NativeContext): Promise<NativeResult>;
export function referencesBaseline(question: ReferenceQuestion, ctx: NativeContext): Promise<NativeResult>;
export function definitionsBaseline(question: DefinitionQuestion, ctx: NativeContext): Promise<NativeResult>;
export function dependentsBaseline(question: DependentQuestion, ctx: NativeContext): Promise<NativeResult>;
export function relevanceBaseline(question: RelevanceQuestion, ctx: NativeContext): Promise<NativeResult>;
export function relevanceGitLogBaseline(question: RelevanceQuestion, ctx: NativeContext): Promise<NativeResult>;
export function astBaseline(question: AstQuestion, ctx: NativeContext): Promise<NativeResult>;
export function globBaseline(question: GlobQuestion, ctx: NativeContext): Promise<NativeResult>;
export function textLiteralBaseline(question: TextQuestion, ctx: NativeContext): Promise<NativeResult>;
export function textRegexBaseline(question: TextQuestion, ctx: NativeContext): Promise<NativeResult>;
export function memoryBaseline(question: MemoryQuestion, ctx: NativeContext): Promise<NativeResult>;
```

`relevanceBaseline` is the rg-only relevance view. `relevanceGitLogBaseline` returns `view: 'git-log'`; `memoryBaseline` returns `view: 'comparison'`. Pass `corpusCommit` when the git view must be limited to a corpus commit, and `gitRoot` when that repository differs from the extracted corpus root.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\rg-runner.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-8-executor-report.md`

## Verification

- `npx prettier --write tools/mcp-bench/src/baselines` — passed.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/baselines/native-baselines.spec.ts` — passed: 3 tests passed, 2 skipped, in 12.344 s.
- `npx eslint tools/mcp-bench/src/baselines` — passed.
- Scoped TypeScript diagnostics for all three source files — 0 errors and 0 warnings.

The two integration cases requiring a live `rg` binary are intentionally skipped when unavailable. In this environment, the configured `RG_PATH` resolves to a missing executable; injected-runner cases still cover every suite, JSON path parsing, resolution order, shell-metacharacter argv handling, and unbounded references.

## Deviations

None. No real-corpus baseline, Nx command, package manifest, or files outside the stated scope were changed.

## Revision 1

- **Injected environment resolution:** `resolveRg` now reads `RG_PATH` from `(options.env ?? process.env)`, so an explicitly injected empty environment does not fall through to the process environment. The resolution-order unit test exercises `RG_PATH`, injected PATH lookup, and the clear missing-binary error.
- **stdin and search roots:** the runner now uses `spawn` with ignored stdin, and appends `.` when its arguments have no explicit search path. Every native baseline `ctx.rg` call supplies a path directly (`.`, `libs`/`apps`, or `.ptah/specs`). The live exit-code-1 test verifies a pathless caller returns promptly as an empty result.
- **ripgrep failures:** nonzero ripgrep exits other than 1 now reject with an error containing exit code and stderr. A live-rg regression test passes an invalid option and asserts the code-2 stderr-bearing error.
- **live-rg test coverage:** live test names state their unavailable-ripgrep skip condition and use a 15-second timeout. The temp corpus includes a relevance fixture; the live every-suite test asserts the answer and command count for symbols, references, definitions, dependents, relevance, AST read, glob, text literal/regex, and memory.

Revision verification used `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe`: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/baselines/native-baselines.spec.ts` passed with 6/6 tests in 12.605 s. `npx prettier --write tools/mcp-bench/src/baselines`, `npx eslint tools/mcp-bench/src/baselines`, and scoped TypeScript diagnostics also passed.

## Revision 2

- **Definitions:** `definitionsBaseline` now uses an anchored declaration pattern that recognizes modifiers, class/object/interface methods, accessors, typed properties, arrow-function variables, and traditional declarations. Results are ranked with same-file hits first and then by path. The live fixture asserts class-method (`sendVerificationEmail`), arrow-const, and interface-method definitions.
- **Relevance views:** `relevanceBaseline` is now rg-only. New exported `relevanceGitLogBaseline` independently runs the case-insensitive keyword git-log view, returns changed files ranked by matching commits, and owns its own commands, latency, output text, errors, and `view: 'git-log'` marker.
- **Separate roots and leakage prevention:** `NativeContext.gitRoot?: string` routes git operations independently from `corpusRoot` (defaulting to it). Every rg invocation prepends exclusion globs for `tools/mcp-bench/questions/**` and `**/node_modules/**`; the live references test confirms a fixture query under the frozen-question path is excluded. A unit test verifies the git-log view uses `gitRoot`.
- **Output limits:** rg now tracks streamed output and reports a command-naming error beyond 512 MiB. Git uses a 512 MiB `maxBuffer` and translates a remaining max-buffer overflow into an error naming the git command.
- **Memory:** memory's comparison git calls now use `gitRoot` through the shared git-log helper.

Revision verification used `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe`: focused Jest passed 7/7 tests in 18.035 s; Prettier and ESLint passed; scoped TypeScript diagnostics reported 0 errors and 0 warnings.

## Orchestrator verification (2026-10-07)

- No `rg` on the Windows PATH of this machine; the real-rg tests skipped in the first pass and hid two defects (Revision 1). All runs below use `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe` (ripgrep 14.1.1).
- Real-question smoke over the pinned extract (`%TEMP%\mcp-bench-b5-corpus`, `gitRoot` = the worktree): after Revision 2 every suite returns answers; definitions 4 of 5 sampled call sites hit@10 (the fifth is a common name with 344 matches); symbols-exact 3/3; dependents 2/2; text 4/4; relevance (rg) 1 of 3 hit@10 with about 0.8-1.0 M characters of output per question, and the git-log view 1 of 3 with 4-6 M characters. These are the honest native costs, not defects.
- Before Revision 2: definitions returned 0 for class methods; relevance mixed the git cost into the rg baseline; rg searched the repository (leaking the frozen question JSON) because one root served rg and git; `git log` overflowed maxBuffer.
- Final checks: `native-baselines.spec.ts` 7/7 with RG_PATH; `npx prettier --check tools/mcp-bench/src/baselines` clean; `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` passed (1 m 56 s).
