# Batch 4 implementation report

## Backend implementation — `TASK_2026_443_40ec`, batch 4

**Tasks completed**: Task 4.1 (`MemoryPromptInjector` records injected hits); Task 4.2 (MCP `ptah.memory.search` records returned hits).

## Completion evidence

### Task 4.1

- `MemoryPromptInjector` optionally injects `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` after the workspace provider and before the optional corpus reader.
- `buildBlock` records exactly the post-`MIN_SCORE` hit ids.
- Recording is skipped for a short query and for zero qualifying hits.
- A throwing recorder is caught locally and cannot change the returned prompt block.
- `buildSessionStartBlock` and `buildCorpusBlock` contain no recording call. Existing null-recorder construction remains a working no-op.
- Specs cover exact filtered ids, short/empty paths, throwing recorder, and the session-start exclusion.

### Task 4.2

- `PtahAPIBuilder` optionally injects the shared recorder token beside `memorySearch` and exposes it only through `getMemoryUsageRecorder` in the memory namespace dependency bag.
- `MemoryNamespaceDependencies.getMemoryUsageRecorder` is optional, preserving existing builders and host configurations.
- A successful `ptah.memory.search` records exactly the returned hit ids. Recorder lookup/call failures are swallowed locally, preserving the successful result and scope metadata.
- `list` does not record memory use. The code namespace and skill-digest paths were not changed.
- Specs cover builder wiring, exact returned ids, a missing recorder, a throwing recorder, and the list exclusion.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\agent-sdk\src\lib\helpers\memory-prompt-injector.ts` — optional recorder injection and failure-isolated recording of injected hits.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\agent-sdk\src\lib\helpers\memory-prompt-injector.spec.ts` — recorder behavior and exclusion coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` — optional recorder injection and memory namespace wiring.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts` — optional recorder getter wiring coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builder.ts` — failure-isolated recording after successful search.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builder.spec.ts` — search recording, throwing/missing recorder, and list exclusion coverage.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-4-report.md` — this report, written after implementation and verification.

## Stack observed

- TypeScript 5.9.3 on Node 24 in Nx 22.6.5 (`package.json`, `.nvmrc`).
- Product dependency injection uses tsyringe decorators and optional token injection (`memory-prompt-injector.ts`, `ptah-api-builder.service.ts`).
- The consumer boundary is the `IMemoryUsageRecorder` port and `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` from `@ptah-extension/memory-contracts`; neither consumer imports a concrete memory adapter.
- MCP search option validation remains the existing Zod 4 schema in `memory-namespace.builder.ts`; no external boundary or validation behavior changed.

## Verification

First test attempt timed out before Nx emitted a header (120-second shell allowance) and was discarded. The unchanged retry emitted the correct 2-project header and found one new fixture pass-through omission; after correcting that test fixture, the required command was rerun unchanged and passed.

### Tests — PASS

Command:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools
```

Observed header and result:

```text
NX   Running target test for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/vscode-lm-tools

@ptah-extension/agent-sdk: 104 passed suites, 2 skipped; 1840 passed tests, 3 skipped
@ptah-extension/vscode-lm-tools: 50 passed suites; 1161 passed tests

NX   Successfully ran target test for 2 projects
```

One of the two test tasks used a valid existing Nx cache output; the changed vscode-lm-tools suite executed and passed.

### Typecheck — PASS

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools
```

Observed header and result:

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/vscode-lm-tools

tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json
tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

NX   Successfully ran target typecheck for 2 projects
```

### Lint — PASS with pre-existing warnings

Command:

```text
npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools
```

Observed header and result:

```text
NX   Running target lint for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/vscode-lm-tools

@ptah-extension/vscode-lm-tools: 0 errors, 21 warnings
@ptah-extension/agent-sdk: 0 errors, 42 warnings

NX   Successfully ran target lint for 2 projects
```

All warnings were in files outside Batch 4 ownership; no Batch 4 file was named by lint.

## Validation and edge cases

- XB1: not applicable to Batch 4 implementation/specs; none of the six source/spec files prepares or executes SQL, so there are no named or positional SQL parameters to bind.
- The recorded prompt ids come only from hits surviving `MIN_SCORE`; the session-start roster and corpus priming remain excluded.
- MCP recording occurs only after `reader.search` succeeds; `list`, code-namespace fallback, and skill digest remain excluded.
- Missing optional recorders are no-ops in both consumers, covering VS Code and other hosts without memory.
- Throwing recorders are isolated by narrow local catches and cannot break prompt construction or turn a successful MCP search into an error envelope.
- Empty/unknown/duplicate/over-200 id behavior belongs to the recorder implementation in Batch 3. These consumers pass their bounded returned/injected id lists without introducing a second validation layer.
- No cached-search candidate path was changed; only the actual injection and returned MCP hits count as use.

## Risk handling

- R-TL6 (parallel shared-worktree activity): only the six Batch 4 files were edited; no Batch 1/3/5 files or `batches.md` were touched. Exact two-project checks were allowed to finish despite shared Nx startup delay.
- R8 / R-TL8 naming in the plan (recording on prompt path): the call is bounded to injected hits (`MAX_HITS = 5`), uses the existing synchronous port, and is failure-isolated. The consumer adds no search, SQL, retry, or await.
- D3 semantic risk: tests pin that short/zero-hit prompts, session-start roster, and MCP list do not record. Corpus priming, code fallback, UI search, `mem:searchIndex`, and skill-digest code were not modified.
- Host reachability risk: recorder injection is optional in both classes and the namespace getter itself is optional, so hosts with no memory registration continue to build and run.
- Failure propagation risk: a deliberately throwing test recorder leaves both the prompt block and MCP search response successful.
- R-TL1 through R-TL5, R-TL7, R-TL9, R-TL10, and lifecycle risks R1-R7/R9-R10 concern migration, SQLite lifecycle stores, retention integration, UI, timing, or later batches; Batch 4 neither changes nor exercises those surfaces.

## Plan deviations

None. The only implementation detail made explicit beyond the pseudocode is a narrow nested `try/catch` around each recorder invocation, required by the stated acceptance behavior for a throwing recorder.

## Out-of-scope observations

- Lint retains 63 warnings across unrelated pre-existing files (21 vscode-lm-tools, 42 agent-sdk), with zero errors.
- Nx prints an advisory that the AI agent configuration is outdated; no configuration update was requested or performed.

## Revision 1

### Diff summary

- M1: `MemoryNamespaceDependencies` now accepts an optional narrow logger; `PtahAPIBuilder` passes its existing logger. A recorder failure is caught as `error: unknown`, logged once at `warn` with the `ptah.memory.search` operation named and a narrowed error message, and the successful search result remains unchanged.
- m2: `MemoryPromptInjector.buildBlock` now completes hit rendering and constructs the final block string before attempting `recordUse`. A malformed hit that makes rendering throw returns `''` and records nothing.
- m3: added negative coverage proving an MCP reader rejection does not record, an injector reader rejection does not record, and corpus priming does not record.
- Scope remained limited to the six Batch 4 files. No memory-curator, memory-contracts, app, task-batch, or Nx configuration file was edited.

### Revision verification

Tests:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools

NX   Running target test for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/vscode-lm-tools

@ptah-extension/agent-sdk: 104 passed suites, 2 skipped; 1843 passed tests, 3 skipped
@ptah-extension/vscode-lm-tools: 50 passed suites; 1161 passed tests

NX   Successfully ran target test for 2 projects
```

Typecheck:

```text
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools

NX   Running target typecheck for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/vscode-lm-tools

NX   Successfully ran target typecheck for 2 projects
```

Lint:

```text
npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools

NX   Running target lint for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/vscode-lm-tools

@ptah-extension/vscode-lm-tools: 0 errors, 21 warnings
@ptah-extension/agent-sdk: 0 errors, 42 warnings

NX   Successfully ran target lint for 2 projects
```

The warnings are pre-existing and occur outside the six Batch 4 files.

### Six-file diff-stat evidence

The requested `git diff --stat` command was not executed because the governing backend-developer role prohibits running git. The six-file scope was instead audited directly; current line counts are recorded below so the team-leader can run the repository-owned git stat during verification:

```text
libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts                                      378 lines
libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.spec.ts                                 934 lines
libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts                       990 lines
libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts                  556 lines
libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builder.ts    322 lines
libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/memory-namespace.builder.spec.ts 621 lines
```

### Revision risks handled

- Recorder failures on the MCP path are now observable without changing the successful result.
- Prompt use is recorded only after successful rendering, so malformed hits cannot create false use signals.
- Failed searches and corpus priming are pinned as non-use paths.
- XB1 remains not applicable: none of these files prepares SQL.
