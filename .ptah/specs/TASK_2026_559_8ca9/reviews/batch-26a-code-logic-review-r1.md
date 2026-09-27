# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 26a r1, Lane H. Recommendation: **REVISE**, **7/10**. The report forwarding and no-host correction work; two bounded rendering gaps should be corrected before the next batch verifies this work. There are no demonstrated Blocking or Serious defects. The score reflects working integration and passing checks, with incomplete handling of unknown support and zero-based locations; these prevent an 8/10 assessment.

| Metric | Value |
| --- | --- |
| Assessment | NEEDS_REVISION |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 1 |
| Failure modes | 3 |

Source and spec files were not edited; no git operation was run. Review scope: the reported 26a contract, namespace forwarding, dispatcher branches, LSP rendering, associated regression cases, and the actual result-budget path. The author report and authoritative task-branch Batch 26a/common checks were examined alongside the language plan's LSP and descriptions sections.

## Numbered findings / failure modes

### 1. R26A-M1 — Unknown host support does not qualify an empty count

- Severity: **Moderate**. Disposition: **fix-now**; verify in 26b.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1335` and `:1351`; the wrapper sets null at `namespace-builders/ide-namespace.builder.ts:451` in the same code-execution directory.
- Trigger: an array-only host returns no definitions for `a.py`, for example because no corresponding provider is installed. The existing VS Code adapter collapses undefined and empty provider results to `[]` at `namespace-builders/ide-capabilities.vscode.ts:73` (references similarly at `:110`).
- Observed result from the real namespace and formatter: `Mechanism: provider-defined; language: python (support decided by the host)` followed by an unqualified `Found: 0 definitions`.
- Current handling: null is correctly retained in the report, but the prose never explicitly says support is unknown, and null is excluded from the empty-answer qualification predicate. Consequently the answer does not distinguish an unverified provider from a supported search with no matches. This is a disclosure gap, not a completely bare response, hence Moderate rather than Blocking.
- Recommendation: render null as `support unknown / not reported by host`; qualify zero results whenever support is not explicitly true, using the existing not-proof-of-absence suffix. Add empty array-host cases for both tools. The current dispatcher array-host spec at `protocol-dispatcher.spec.ts:7071` exercises a positive location, so its unqualified positive count can remain unchanged.
- Related compatibility edge: direct legacy `formatLspDefinitions([])` still emits only `Found: 0 definitions` (`mcp-response-formatter.ts:1284`). Keep the array APIs, but normalize a legacy formatter array to unknown/provider-defined disclosure where feasible; the new dispatcher itself does not use this legacy branch.

### 2. R26A-M2 — Valid zero-based coordinates disappear

- Severity: **Moderate**. Disposition: **fix-now** in the shared renderer; verify in 26b.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1372` uses truthiness for line and column; `types.ts:1608` documents zero-based line numbers.
- Trigger/probe: report locations `{file:'a.ts',line:0,column:4}` and `{file:'b.ts',line:3,column:0}`.
- Observed result: `a.ts` and `b.ts:3`, rather than `a.ts:0:4` and `b.ts:3:0`. A first-line target loses both coordinates, and a first-column target loses its column, making returned locations less precise.
- Classification: pre-existing behavior, now shared by both newly rendered report methods. It is in scope to correct while changing this renderer. The cited old tests at `mcp-response-formatter-extra.spec.ts:102` and `:108` cover missing coordinates, not zero; they do not require keeping the defect.
- Recommendation: test presence/type instead of truthiness, preserving numeric zero. Cover both report tools and the legacy array path, with separate assertions for omitted coordinates.

### 3. R26A-m1 — execute_code help does not expose the report APIs

- Severity: **Minor**. Disposition: **carry-to-24c**.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:253` lists only the array methods and says all methods return `[]` when unavailable.
- Trigger: an agent reads `ptah.help('ide.lsp')` to choose an API. It is directed to the old empty-array methods and never learns how to inspect mechanism/support/caps.
- Recommendation: add both report methods and distinguish their no-host report from legacy array behavior. Explicitly include this help file in 24c's handoff, alongside the planned tool-description changes. The language plan assigns host-mechanism descriptions to 24c; this is not a reason to hold 26a's runtime forwarding.

## Five logic questions

1. **Silent failure?** No-host now explicitly reports that no lookup ran (`mcp-response-formatter.ts:1319`). Unknown array-host support can still look more conclusive than warranted: finding 1.
2. **Unexpected user action?** Looking up a first-line or first-column symbol drops coordinates: finding 2. Looking up API help omits the safer report methods: finding 3.
3. **Wrong-answer inputs?** Empty results with `languageSupported:null` and numeric zero positions reproduce the two rendering gaps. Explicit unsupported, truncated, and approximated reports are qualified at `mcp-response-formatter.ts:1351`.
4. **Dependency failure?** Capability report promises are returned directly at `ide-namespace.builder.ts:274` and `:290`, so rejection is not converted to an empty success in the new wrapper. VS Code's absent/empty provider result remains indistinguishable without the qualifier in finding 1. Malformed report-shaped input outside the contract may fall back to JSON (`mcp-response-formatter.ts:1279`); no stronger runtime validation is claimed.
5. **Missing requirement?** The null-support presentation and zero-versus-missing coordinate distinction need explicit regression expectations. Report-aware execute_code help needs a concrete 24c owner/file, rather than only a general descriptions promise.

## Data flow and requirements

| Stage / requirement | Result and evidence |
| --- | --- |
| Host report preferred, both methods | Complete: `ide-namespace.builder.ts:273`, `:289`; specs at `ide-namespace.builder.spec.ts:198` verify identity and no array fallback. |
| Existing array methods retained | Complete: `ide-namespace.builder.ts:242`, `:256`; wrappers add provider-defined reports without replacing arrays. |
| No host distinguished from empty search | Complete: `ide-namespace.builder.ts:457`; dispatcher calls report methods at `protocol-dispatcher.ts:981`, `:1001`; formatter none branch at `:1319` has no Found line. |
| Unknown language support honest | Contract is honest (`types.ts:1596` permits null); prose/empty qualification needs finding 1. |
| Unsupported / approximation / cap caveats precede locations | Complete for tested contract shapes: `mcp-response-formatter.ts:1336`; real budget probe retained all caveats. |
| Coordinates preserved | Partial: finding 2. |
| Definition freshness hook | Preserved before report delegation, `ide-namespace.builder.ts:272`; spec at `ide-namespace.builder.spec.ts:261`. |
| Help / descriptions | Carry finding 3 to 24c. |

The two type-only barrel exports at `src/index.ts:28` are justified for the 26b host implementation. `languageSupported:null` is preferable to inventing support. Omitting a language-server mechanism is acceptable for this batch because the existing array-only VS Code path cannot attest which mechanism answered; provider-defined states that limitation.

## Edge cases and budget evidence

- Actual temporary Node probe: `node "$env:TEMP/task559-26a-r1-probe.cjs"`. It transpiles the on-disk modules, exercises the namespace builder and actual formatter, and uses the real `applyToolResultBudget`; outputs/spool are in an OS-temp mkdtemp directory.
- No host: no Found line; explicit nothing-searched explanation.
- Unsupported and truncated empty reports: not-proof-of-absence suffix retained.
- Array-only host and zero coordinates: outputs described in findings 1 and 2.
- 2,000 locations, text-scan approximation, unsupported language and truncated flag: markdown-outline reduction produced **425 characters / 128 tokens**, kept mechanism, support, approximation, cap, and count ahead of its omitted-list marker. All caveats survived. LSP need not be added to preformatted merely to satisfy this tested case.
- Legacy empty array remains a bare count; it is compatibility behavior, not the new dispatcher's no-host path.

## Verification

- Requested scoped command, with `NX_ISOLATE_PLUGINS=false` and `NX_DAEMON=false`: `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache` — **all three passed**, header confirms one project. Log: `%TEMP%/task559-26a-r1-checks.log`; one completion check, no rerun.
- `ptah_get_diagnostics` scoped to builder and formatter — errors 0, warnings 0.
- CLI and Electron scoped typechecks — passed.
- `ptah-electron:validate-deps` — passed.
- `degradation-audit:lint` — passed, **TOTAL 300**.
- New no-host and preferred-report regression cases are consistent with their claimed failure on the old implementation. The author's base-swap evidence was read; no source swapping or git operations were performed by this reviewer.
- Residual uncertainty: this review uses controlled capability results, not a live VS Code language-server session; 26b's Electron mechanism accuracy remains its own acceptance scope. Passing tests do not currently cover the empty-null-support warning or zero coordinates.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** on the reproduced rendering gaps and the passing scoped checks.
- Score: **7/10**.
- Top risk: an empty array-only provider answer implies more certainty than its unknown support warrants.
- Required bounded correction: findings 1 and 2, verified by the next 26b review under Decision 24. Carry finding 3 to 24c. No additional review round is requested.
