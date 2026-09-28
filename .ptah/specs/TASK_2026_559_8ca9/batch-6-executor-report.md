# Batch 6 executor report — index freshness at the MCP surface

Executor: backend-developer (sub-agent). Tasks 6.1, 6.2 and 6.3 are done. No git operations were run.

## Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`:
  adds `ensureIndexFresh()`, the `index` block on every `searchSymbols` result, a background full `reindex()`,
  `CODE_INDEX_STALE_MS`, and the new deps `getHostWorkspaceRoots`, `logger` and `now?`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`:
  19 new specs
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`:
  adds `buildCodeReindexTool()`. The `ptah_code_search_symbols` description now names the `index` block
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`: registers the tool
  in the `code` group right after `ptah_code_search_symbols` (not eager), adds a `ptah_code_reindex` case, adds
  `startIndexFreshnessCheck` on `ptah_lsp_definitions`, and updates the tools/list doc comment
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`: 10 new specs.
  Also adds `ptah_code_reindex` to the anonymous full-set list
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`: Task 6.3
  guard
- MODIFIED (outside the batch file list) `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`:
  wires `getHostWorkspaceRoots` and `logger`. Prettier also rewrote 3 constructor union types in this file
  (`| X | undefined` became `X | undefined`) with no semantic change; `prettier --check` requires it
- MODIFIED (outside the batch file list) `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`:
  the execute_code help said `reindex()` "returns IndexingStats" and was "the only way to trigger reindex". Both
  are false now. The help now documents the new return shapes and adds a `ptah_code_reindex` entry. This is not
  one of the shared constants User Decision 4 freezes (`ptah-core-prompt.ts`, `NATIVE_AGENT_TOOL_POLICY`)
- MODIFIED (outside the batch file list) `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/internal-mcp.md`:
  the tool catalog. `code` goes from 9 to 10 tools, it gets the new row, and each total goes up by one

## Task 6.1 — `ensureIndexFresh` and freshness in search results

- `ensureIndexFresh()` reads `reader.getIndexFreshness(searchRoot)`
  - Missing method or missing reader: unknown freshness (`symbolCount: null`) and no trigger
  - Missing indexer: freshness is reported but no reindex starts
- Stale means `symbolCount === 0`, or an age above 24h. An age is never computed from `newestUpdatedAt === null`
  (`indexAgeMs: null`, not stale)
- A trigger calls `indexer.indexWorkspace(hostRoot, { userInitiated: false })` inside
  `Promise.resolve().then(...)` and does not await it. The run is governed because the indexer's own
  `yieldToForeground` runs on every non-user-initiated run (`code-symbol-indexer.service.ts:239-242`). Nothing
  bypasses the governor
- There is a per-root in-flight latch (`Set`). It is set synchronously before the call returns and cleared in
  `.finally` when the run settles
- A lazy run also records its start time. Another lazy run starts only when 24h have passed since the last start
  (risk table: "a re-check only after the 24h threshold"). This stops a run that leaves the index empty (no source
  files, or every file failed) from restarting on every symbol call
- A rejection is caught and logged at warn with fixed text plus `{ errorName, userInitiated }`. An `AbortError`
  (the governor stopping for shutdown) is not logged
- `searchSymbols` returns `index: { symbolCount, indexAgeMs, reindexStarted, reindexInFlight }` on success and on
  every error variant
- `reindex()` without `filePath` starts a `userInitiated: true` background run (not awaited) and returns
  `{ started, symbolCount, indexAgeMs, reindexInFlight }`. If a run for that root is already in flight, it
  returns `started: false`. The `filePath` path is still awaited and returns the same stats as before
- Clock: `deps.now` (defaults to `Date.now`)

## Task 6.2 — `ptah_code_reindex` and dispatcher wiring

- `buildCodeReindexTool()` has one optional `filePath`; annotations `{ destructiveHint: false, idempotentHint: true }`
- It is listed in the `code` group after `ptah_code_search_symbols`. It is not in any `*_EAGER_TOOLS` set
- Telemetry: `registeredToolNames` is derived from `buildToolDefinitions`, so the new tool is logged by name
  without a list edit. Budget: the default 8k budget is enough for this small JSON result, so no override or
  content hint was added
- Case `ptah_code_reindex`:
  - Returns an error result when there is no `ptahAPI.code`, and when the namespace returns `{ error }` (VS Code
    has no indexer)
  - A non-string or relative `filePath` gets an error result, and `reindex` is not called
- `ptah_lsp_definitions` calls `startIndexFreshnessCheck` before `getDefinition`. It runs inside a promise chain,
  so a namespace that failed to build (a proxy that throws synchronously) cannot fail the lookup
- `ptah_code_search_symbols` does not call `ensureIndexFresh` a second time; see Plan deviations

## Task 6.3 — description guard

- `tool-description.builder.spec.ts`: the existing 1,000-char budget is now the shared constant
  `DESCRIPTION_CHAR_BUDGET`. The new spec asserts:
  - the `ptah_code_reindex` description is under that budget
  - the schema's properties are exactly `['filePath']`
  - nothing is required

## Risks

- **Deadlock (TASK_2026_437).** No path awaits `indexWorkspace` from a tool call. The lazy run is governed and
  fire-and-forget. The explicit full run is user-initiated (ungoverned, as the batch requires) and also not
  awaited. Spec: "returns before the background run settles"
- **Double run.** Three guards:
  1. the per-root in-flight latch
  2. the 24h start throttle
  3. an explicit run that finds the latch set returns `started: false`
- The specs pin the double-run behaviour: exactly 1 run across 3 concurrent calls; no second run while one is
  in flight past the 24h gap; an explicit reindex during a lazy run does not start another
- A mutation check removed the latch condition. The original specs still passed (the throttle hid it). I added
  the "in flight past the 24h gap" spec, which fails against that mutant (1 failed / 23 passed), and restored the
  code
- **Optional `getIndexFreshness`.** When it is absent: unknown freshness and never a trigger (spec). When it
  rejects: `ensureIndexFresh` resolves to the unknown status and logs fixed text (spec asserts no path leaks)
- **Host-owned root (Batch 2f F1).** A reindex runs only when the searched root string is exactly one of
  `getHostWorkspaceRoots()`. That list holds:
  - the session-derived root with the caller-declared tier left out (`resolveSessionWorkspaceRoot` without
    `getCallerWorkspaceRoot`, so caller session → active session → provider)
  - the platform's `getWorkspaceFolders()`
- Exact equality is also a correctness condition: the index is keyed by the root string, so a reindex under any
  other spelling would not refresh the rows the search reads
- A declared root the host did not record still gets a read-only freshness report. It never gets a reindex, lazy
  or explicit. Specs cover both
- **Degradation audit.** Three new catches, each carrying a `// degradation-audit: reported — …` marker; all log
  lines use fixed text:
  - `ensureIndexFresh`'s `catch`
  - the background run's `.catch`
  - the dispatcher's `startIndexFreshnessCheck` `.catch`

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`:
  "Successfully ran targets test, lint, typecheck". Full suite: 69 suites, 1614 tests passed
- Batch 6 specs only (`--testNamePattern="ensureIndexFresh|reindex|Batch 6|index freshness"`): 30 passed
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`
  and "Successfully ran target lint". The 2 listed sites are the existing `analysis-namespace.builders.ts:364/:376`.
  `baseline.json` is not edited
- `node_modules/.bin/prettier --check` on every changed file under `libs/` and `apps/`: "All matched files use
  Prettier code style!"
- `ptah-electron:validate-deps`: not run. No app wiring changed; the only app file touched is a Markdown asset

## Plan deviations

- **The search case does not call `ensureIndexFresh` in the dispatcher.** `searchSymbols` runs it internally, so
  `execute_code` callers get it too, and returns its outcome as `index`. A second dispatcher call would read
  freshness twice and report `reindexStarted: false` from the call that did not start the run
  - The dispatcher spec proves the search path runs the check end to end: a real `buildCodeNamespace` is behind
    the MCP call, and `getIndexFreshness` and `indexWorkspace(..., {userInitiated:false})` are asserted
- **Three files outside the batch list** (see Files): `ptah-api-builder.service.ts` (needed for a host-owned root),
  `ptah-system-prompt.constant.ts` (a documented return shape became false), `internal-mcp.md` (the tool
  catalog)
- **`ptah_code_reindex` accepts only an absolute `filePath`.** `reindexFile` needs an absolute path, and resolving
  a relative one would go through the caller-declared root

## Out-of-scope observations

- The host boot path also runs `indexWorkspace` (`thoth-runtime/boot-thoth-runtime.ts:485`,
  `ptah-extension-vscode/activation/wire-runtime.ts:207`). The in-flight latch is per code namespace, so a lazy
  run can overlap a boot-time run for the same root. Both are governed or run at boot, so this is not a
  deadlock. The indexer has no cross-caller latch
- `internal-mcp.md` was already inaccurate before this batch:
  - the always-on group lists 12 tools, but the dispatcher has 15 (`ptah_dashboard_propose_spec`,
    `ptah_surface_update`, `ptah_surface_get_state` are missing)
  - the "51 tools" headline and the "= 52" sum disagreed
  - I only added one to each count; the underlying drift is not fixed

## Revision round 1

Review: `reviews/batch-6-code-logic-review-r1.md` (REVISE 7/10, 2 moderate). Both findings fixed.

### M1 — execute_code definition lookups bypassed the freshness check

- `buildIDENamespace(capabilities, options)` takes an optional `onDefinitionLookup` hook. The capability-backed
  `lsp.getDefinition` runs it after input validation and before delegating; no other LSP call runs it
- `startIndexFreshnessCheck(code, logger)` moved from the dispatcher into `code-namespace.builder.ts` (exported
  through `namespace-builders/index.ts`). Fire-and-forget inside a promise chain, so a failed-build proxy that
  throws synchronously can never fail or delay the lookup; fixed-text debug log with a `// degradation-audit:`
  marker
- `PtahAPIBuilder` now builds the `code` namespace first and wires
  `onDefinitionLookup: () => startIndexFreshnessCheck(code, this.logger)` into the `ide` namespace, so the direct
  `ptah_lsp_definitions` tool and `execute_code` share one hook
- The dispatcher's `ptah_lsp_definitions` hook and its local `startIndexFreshnessCheck` are removed, with their two
  dispatcher specs (their behaviour is now covered at the namespace layer)

### M2 — explicit reindex returned a freshness-read error after starting the run

- `reindex()` full-run path reads freshness through `readAdvisoryFreshness`: a rejecting read logs fixed text at
  warn (`// degradation-audit:` marker) and yields unknown freshness. `started` and the actual latch state
  (`reindexInFlight`) are kept; `symbolCount`/`indexAgeMs` are `null`. `ensureIndexFresh()` is not used as the
  fallback

### Specs added

- `code-namespace.builder.spec.ts` — `buildCodeNamespace.reindex`: "keeps the start acknowledgment of a newly
  admitted run when the freshness read rejects"; "reports an already-in-flight run when the freshness read rejects"
- `code-namespace.builder.spec.ts` — `startIndexFreshnessCheck`: "starts ensureIndexFresh without waiting on it";
  "never throws when the namespace is a failed-build proxy, and logs fixed text"
- `ide-namespace.builder.spec.ts` — "runs onDefinitionLookup once per valid definition lookup, and for no other LSP
  call"
- `code-execution.engine.spec.ts` — `executeCode — index freshness through the namespaces`: "a definition lookup
  starts the freshness check and a lazy reindex"; "a symbol search starts the freshness check and a lazy reindex"
  (real `executeCode`, `buildIDENamespace`, `buildCodeNamespace`; only capabilities, reader and indexer are doubles)

### Correction to the original out-of-scope note

The reviewer is right: `thoth-runtime/boot-thoth-runtime.ts:485` is inside the `runSymbols` callback installed on
`IndexingRpcHandlers` (`:526`), not an immediate boot-time run. The only boot-time overlap candidate is the VS Code
startup call at `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:207`, plus UI-triggered `runSymbols`
runs. The namespace latch cannot coordinate with either. This is a residual resource/concurrency risk, not a
deadlock; the store upserts by workspace/subject, so overlap alone does not duplicate rows

### Verification (round 1)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` —
  all three targets passed
- Scoped jest on the three touched spec files — 3 suites, 74 tests passed
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — passed; the audit line for this library
  reads `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`
- `prettier --check` on the nine changed files — clean after `--write` on `protocol-dispatcher.spec.ts` (a
  leftover blank line from the removed specs)

## Bounded correction (round 2 review)

Source: `reviews/batch-6-code-logic-review-r2.md`, finding F1 (moderate). Round-1 M1 and M2 were confirmed fixed.

### F1 — search lost the known in-flight state when the freshness read rejected

`ensureIndexFresh`'s failure path hardcoded `reindexInFlight: false`, so a search issued while a run was
pending and the freshness reader rejected reported no run in flight, while an explicit `reindex` correctly
reported one.

Fix (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`):
`ensureIndexFresh` now captures the searched root before the freshness await and passes it to
`checkFreshness(searchRoot)`; the failure response reports `reindexInFlight: inFlight.has(searchRoot)`.
`symbolCount`/`indexAgeMs` stay `null` and `reindexStarted` stays `false`. The failure path schedules nothing and
resolves no other root. The root is read inside the `try`, so the function still never rejects. The
degradation-audit comment was updated in place; the logged text is unchanged.

Regression specs (`code-namespace.builder.spec.ts`):

- `buildCodeNamespace.ensureIndexFresh` › `still reports a pending run as in flight when the freshness read rejects`
- `buildCodeNamespace.searchSymbols — index freshness` › `reports a pending run as in flight when the freshness read rejects`

Both admit a run via `reindex()` (indexer promise left pending), switch the reader's `getIndexFreshness` to
reject, and assert `{symbolCount:null, indexAgeMs:null, reindexStarted:false, reindexInFlight:true}`, exactly
one indexer invocation, and no path text in the warn log.

### Verification (round 2 correction)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` —
  all three targets passed (69 suites, 1621 tests on the static-output test run)
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` — passed; `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`
- `prettier --check` on the two changed source files — clean
