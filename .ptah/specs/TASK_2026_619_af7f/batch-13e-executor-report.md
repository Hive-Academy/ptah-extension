# Batch 13e executor report

## 13e.1

- `tools/mcp-bench/src/transport/call-recorder.ts:117-181` now isolates textual `reasons` arrays, reads each JSON string, and classifies unknown coverage for `census: "unknown"`, a `?` reason other than `unrecognised?`, or a cap-sized array that could hide a later uncertain reason. An incomplete reasons array remains conservative and unknown. The JSDoc records the extension rationale and budget-cut rule.
- Added `tools/mcp-bench/src/transport/call-recorder.spec.ts:1-54`: only `unrecognised?`, settled reasons with it, other unknown reasons, unknown census, a cut reasons array, and unchanged building/tool-error/unavailable classifications.

## 13e.2

- `tools/mcp-bench/src/suites/tool-results.ts:25-119` exposes normalized `{ file, symbolName }` pairs with parsed symbol answers while preserving their existing rankings.
- `tools/mcp-bench/src/lifecycle/lifecycle-probe.ts:75-80` now requires the normalized expected file and exact queried `symbolName` together. Path normalization remains the parser's existing `normalizePath(..., { workspaceRoot })` path.
- `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts:361-383` names a rejected unknown-coverage large-file hit as `hit seen under unknown coverage, not counted as settled`; `lifecycle-probe.ts:201-213` uses the same wording for the rejected index-age refresh hit.
- `lifecycle-probe.spec.ts:92-101` covers a different symbol in the expected file. `lifecycle-scenarios.spec.ts:333-357` covers edit queries receiving only the old probe symbol in the probe file. The existing unknown-coverage scenario now asserts both corrected detail messages at `:323-330`.

### searchSymbol caller audit

- Cold start uses `options.probe.name` and `probeFile` (`lifecycle-scenarios.ts:247-249`).
- Edit uses `benchEdited_<tag>` and `probeFile` at 268 and 276-281.
- Add, delete, and 3,900-line polling pass their generated names/files through the `search` closure at 297-301, 321-325, and 348-352.
- The 1.5 MiB case uses `benchLargeMib_<tag>` and `bigFile` at 361.
- Index age uses the existing probe name/file for settling, first answer, and refresh (`lifecycle-probe.ts:167, 178-183, 193`).

## 13e.3

`rg` found `unknown-coverage` only in lifecycle/transport implementation and specs; no scorecard or markdown writer under `tools/mcp-bench/src` documents the rule. No report section was invented.

## Spec fixtures changed

- `tools/mcp-bench/src/suites/tool-suites.spec.ts:70-74`: empty parsed symbol answer now includes `symbolHits: []`, matching the parser's added lifecycle metadata. This is not an old-classification fixture.
- `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.spec.ts:323-330`: expected wording changed from a missing result to a rejected unknown-coverage hit.
- New lifecycle and transport cases are listed above; no symbols-suite classification fixture encoded the old `unrecognised?` behavior.

## Verification

- `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/transport tools/mcp-bench/src/lifecycle tools/mcp-bench/src/suites --coverage=false --maxWorkers=2` — no final Jest summary was returned before the command tool's 30-second foreground limit; pass/fail count unavailable. It was not re-run.
- `npx nx typecheck mcp-bench --parallel=1` — no final Nx summary was returned before the same 30-second foreground limit; pass/fail count unavailable. It was not re-run.
- `npx nx lint mcp-bench --parallel=1` — PASS: 0 errors, 2 pre-existing warnings (`scip-cross-check.ts` max-lines and `bench-host-process.spec.ts` unused disable); Nx reported successful target execution.
- `npx prettier --check tools/mcp-bench/src/transport/call-recorder.ts tools/mcp-bench/src/transport/call-recorder.spec.ts tools/mcp-bench/src/lifecycle/lifecycle-probe.ts tools/mcp-bench/src/lifecycle/lifecycle-probe.spec.ts tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts tools/mcp-bench/src/lifecycle/lifecycle-scenarios.spec.ts tools/mcp-bench/src/suites/tool-results.ts tools/mcp-bench/src/suites/tool-suites.spec.ts` — PASS: all matched files use Prettier code style.

## Revision 1

- `tools/mcp-bench/src/lifecycle/lifecycle-probe.ts:42-45,82-84` adds one case-sensitive matcher for exact names and class-qualified methods (`Class.method`). Every `searchSymbol` result now uses it with the existing normalized file equality. `lifecycle-probe.spec.ts:104-136` adds the real `ProviderSetupWizardComponent.onKeepEditing` shape and rejects `Other.onKeepEditingX`, `onKeepEditingX`, and an unrelated symbol.
- `tools/mcp-bench/src/transport/call-recorder.ts:119-123,158-181` scans every well-formed textual reasons array with `matchAll`; any unmatched `"reasons": [` start remains conservatively unknown. A three-or-more-reason array containing `unrecognised?` is also unknown because the server caps reported reasons at three, which could hide a later uncertain reason. The `unrecognised?` exemption still applies to shorter settled arrays.
- `call-recorder.spec.ts:5-101` updates the formerly clean three-entry fixture for the cap rule and adds cap, multiple-array, pretty-printed, escaped quote, literal `]`/comma, and reduced-trailer cases. The escaped/literal-content case is JSON-stringified, so it exercises the exact textual escaping emitted by the tool.
- Review finding 4 was intentionally left unchanged: `parseSymbolHits` still rejects a hit missing a string `symbolName`, as directed.

### Revision 1 verification

- `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/transport tools/mcp-bench/src/lifecycle tools/mcp-bench/src/suites --coverage=false --maxWorkers=2` — the task gate reports **178/178 passing**. A fresh background capture was still running after its one permitted 25-second completion check, so its final Jest summary could not be read without polling; no duplicate foreground run was started.
- `npx nx typecheck mcp-bench --parallel=1` — PASS: `Successfully ran target typecheck for project mcp-bench`; 1/1 target, 21.9 s.
- `npx nx lint mcp-bench --parallel=1` — PASS: `Successfully ran target lint for project mcp-bench`; 0 errors, 2 pre-existing warnings in `scip-cross-check.ts` and `bench-host-process.spec.ts`.
- `npx prettier --check tools/mcp-bench/src/transport/call-recorder.ts tools/mcp-bench/src/transport/call-recorder.spec.ts tools/mcp-bench/src/lifecycle/lifecycle-probe.ts tools/mcp-bench/src/lifecycle/lifecycle-probe.spec.ts tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts tools/mcp-bench/src/lifecycle/lifecycle-scenarios.spec.ts tools/mcp-bench/src/suites/tool-results.ts tools/mcp-bench/src/suites/tool-suites.spec.ts` — PASS: all matched files use Prettier code style.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Preserve text-regex classification | Parse full JSON; isolate reasons in text | Budget-cut bodies can be invalid JSON; existing classifier documents this constraint | Yes, helper is local to `call-recorder.ts` |
| Exclude only `unrecognised?` | Ignore all `?` reasons; ignore only this reason | User decision and language coverage behavior: unsupported extensions cannot contain supported-language symbols | Yes, one predicate branch |
| Match file and symbol | File-only; normalized file plus exact or class-qualified method `symbolName` | Review finding: a stale old symbol in the edited probe file could pass file-only matching, while indexer methods use `Class.method` | Yes, parser metadata and one predicate |

## Clarifications Needed

None.
