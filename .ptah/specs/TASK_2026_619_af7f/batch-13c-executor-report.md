# Batch 13c executor report

## Outcome

Implemented known partial code-symbol coverage while a full census is writing.

1. `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:601-627`
   now keeps the existing unknown result only until discovery has set the active
   run's `census`. Afterwards it reads the active run, reports `state:
   'updating'`, and uses that run's selected files and writes rather than a
   prior settled run.
2. `code-symbol-indexer.service.ts:631-690` adds the shared private
   `coverageForRun` helper. Both active and settled answers merge census writes
   with newer `perFile` writes by sequence, calculate unchecked selected files,
   failure reasons, unsupported language counts, omitted-by-cap, and the C
   parsed-as-C++ approximation in exactly one place. The settled branch keeps
   its existing `perFileTruncated` census behavior.
3. `code-symbol-indexer.service.ts:587-599` documents unknown coverage during
   discovery and known partial coverage after selection.
4. `code-symbol-indexer.service.spec.ts:689-791` adds real-indexer coverage
   tests for held discovery, complete partial coverage, concurrent `reindexFile`,
   and truncated partial coverage. Existing settled coverage tests remain green.

## Coverage shapes and reasons

For the tested complete census of three selected TypeScript files before a
write, the active JSON fields are:

```json
{
  "clean": false,
  "reasons": ["updating", "unrecognised?", "unchecked"],
  "census": "complete",
  "state": "updating",
  "analyzed": 0,
  "unchecked": 3,
  "failed": 0,
  "unsupported": 0,
  "unrecognised": null,
  "nonSource": null,
  "excluded": null,
  "omittedByCap": 0
}
```

After the same census settles, the unchanged settled shape is:

```json
{
  "clean": false,
  "reasons": ["unrecognised?"],
  "census": "complete",
  "state": "current",
  "analyzed": 3,
  "unchecked": 0,
  "failed": 0,
  "unsupported": 0,
  "unrecognised": null,
  "nonSource": null,
  "excluded": null,
  "omittedByCap": 0
}
```

`unsupportedByLanguage`, `failedByReason`, and `approximations` are absent in
these TS-only clean-write examples; they are included when their corresponding
active or settled run has observations. A truncated active census additionally
has `census: "truncated"`, `censusLimit: 2`, and `omittedByCap: 1` in the new
test.

The `unrecognised?` reason is not introduced by Batch 13c: the settled answer
already has it because `withCoverageVerdict` maps `unrecognised: null` to that
reason, while it intentionally allows `excluded: null`. Per the requested
settled-answer reference, the helper was not changed. The active answer adds
only `updating` and, while selection remains unwritten, `unchecked`; its sole
`?` reason exactly matches the settled answer.

## Consumer audit

Searched `getCoverage(` and `updating` under `libs/backend` and `libs/shared`.
The production symbol-index consumer is
`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts:290-304`;
it passes the `LanguageCoverage` through unchanged. Its spanning-read logic at
`:551-558` only preserves an already-observed updating state and makes no null
count assumption. `mcp-response-formatter.ts` labels `updating` for display;
the platform verdict helper already supports numeric updating counts. No
consumer change was required.

## Verification

- `node ...jest.js -c libs/backend/workspace-intelligence/jest.config.ts code-symbol-indexer --coverage=false --maxWorkers=2 --moduleNameMapper=...` (run through `child_process.spawnSync` so PowerShell preserved the JSON mapper): PASS, 2 suites, 65 tests.
- Same Jest form over the nine additional specs returned by
  `rg -l 'getCoverage|withCoverageVerdict'` in workspace-intelligence: PASS,
  9 suites, 478 passed, 1 skipped (479 total).
- `npx nx typecheck workspace-intelligence --parallel=1`: PASS.
- `npx nx lint workspace-intelligence --parallel=1`: PASS, 0 errors and 74
  pre-existing workspace warnings; no lint errors in the changed files.
- `npx prettier --check libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts`: PASS after formatting the spec.
- Scoped TypeScript diagnostics after the final formatting change: 0 errors,
  0 warnings.

The first direct Jest invocation failed before executing tests because PowerShell
stripped the JSON passed to `--moduleNameMapper`; the required spawnSync form
was then used for the passing runs above.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Share coverage accounting | Duplicate active accounting; extract a private helper | The settled branch already had the required latest-write merge; one helper prevents drift. | Yes, private-only refactor. |
| Preserve `unrecognised?` | Change verdict helper; retain settled behavior | `language-coverage.interface.ts:306-316` yields the same reason for settled `unrecognised: null`; task requires settled behavior as reference. | Yes, platform contract change if later approved. |
| Do not modify consumers | Change MCP/tool consumers; retain pass-through | Production audit found no `updating => null counts` assumption. | Yes. |

## Clarifications Needed

None.
