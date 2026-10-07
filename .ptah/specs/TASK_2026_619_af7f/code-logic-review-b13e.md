# Code Logic Review — Batch 13e

## Verdict: REVISE — 5/10

The `unrecognised?` carve-out in `hasUnknownReason` is sound and I found no false-clean for any realistic reasons-array shape. The new `symbolName` requirement in `searchSymbol` is wrong for the real cold-start probe. The probe query is a method name (`onKeepEditing`). The product reports methods as `Class.method`, so an exact match never succeeds and `cold-start` and `index-age` can never pass. The spec mocks use `symbolName === query`, so they hide this.

## Findings

1. **SERIOUS — exact `symbolName === name` makes cold-start and index-age unpassable for method probes.**
   - Evidence:
     - `tools/mcp-bench/src/lifecycle/lifecycle-probe.ts:77-79` requires `hit.symbolName === name`.
     - `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts:150-165` sets `probe.name = question.query` and prefers the `large` stratum.
     - The first large question in `tools/mcp-bench/questions/7910f34cf/symbols-exact.json` is `symbol-large-101`, query `onKeepEditing`, truth `provider-setup-wizard.component.ts:2334`. That line is `protected onKeepEditing(): void {`, a class method.
     - The indexer emits method chunks with `symbolName: \`${className}.${methodName}\`` (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:1496`).
     - The dispatcher passes `h.symbolName` through unchanged (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts:395`).
   - Scenario: the hit is `ProviderSetupWizardComponent.onKeepEditing`, which is not `onKeepEditing`, so `found` stays false. This affects:
     - `cold-start` (`lifecycle-scenarios.ts:243-249`), which times out and reports "no correct answer".
     - `index-age`, which calls `searchSymbol(... options.probe.name ...)` at `lifecycle-probe.ts:167,178,193`.
     - `symbolScopeScenario` (`lifecycle-scenarios.ts:617`) only counts hits, so it is unaffected.
   - Fix: match by the unqualified member name: `hit.symbolName === name || hit.symbolName.endsWith('.' + name)`. Put this in one helper so the case-sensitive exact match is kept. Alternatively, make `probeSymbolOf` select only a top-level function or class, or carry the hit's real `symbolName` from the questions file. Add a spec with a `Class.method` hit.

2. **MODERATE — the `reasons` cap of 3 can hide an unknown reason behind `unrecognised?`.**
   - Evidence:
     - `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts:244,354-357` caps `reasons` at 3, in priority order.
     - `unrecognised?` ranks before `omitted?` and `resolution?` (lines 205-226).
     - A listing such as `["updating","stale","unrecognised?"]` can hide `omitted?` or `resolution?`. `hasUnknownReason` in `call-recorder.ts:158-174` then scores it clean.
   - Impact: unlikely, because it needs two observed qualifiers at once. The compact block also does not expose `omittedByCap: null` to the regex.
   - Fix: when the array has `MAX_REPORTED_REASONS` (3) entries and contains `unrecognised?`, treat it as unknown. Or additionally require that no sibling `"omittedByCap":null` key is present.

3. **MINOR — only the first `"reasons"` array is read.**
   - Evidence: `REASONS_ARRAY.exec(text)` at `call-recorder.ts:161` takes the first match.
   - The dispatcher emits one coverage block, and `coverage` precedes `hits` (`code-namespace.builder.ts:~397-403`). Hit text is JSON-escaped, so an embedded `"reasons"` cannot match.
   - A multi-block response (for example from another tool) could let an earlier clean array mask a later unknown one.
   - Fix (optional): use `matchAll` and flag unknown if any array is unknown.

4. **MINOR — `parseSymbolHits` now throws when a hit lacks a string `symbolName`.**
   - Evidence: `tools/mcp-bench/src/suites/tool-results.ts:99-100`.
   - Suite scoring (`ranked`, `abstained`) is unchanged. The legacy fallback path always supplies a string (`code-namespace.builder.ts:446`), so this is acceptable. It is a stricter contract than before, and a malformed hit now aborts a suite question instead of being tolerated.

5. **MINOR — test gaps** (`tools/mcp-bench/src/transport/call-recorder.spec.ts`, `lifecycle-probe.spec.ts`):
   - No `Class.method` hit case. This is finding 1.
   - No pretty-printed reasons case, for example `JSON.stringify(x, null, 2)` with each reason on its own line. I verified by reading the regex that `\s*` handles it.
   - No case for an escaped quote or a `]` or `,` inside a reason string.
   - No case for a budget-cut body where the array closes and the `[reduced: …]` trailer follows.
   - No case for the reasons-cap-hidden scenario.

## Failure-mode checks

- **`[]`**: matches via the empty-optional group, no strings, clean. Verified, and covered by a test.
- **`["unrecognised?"]`**: clean. Covered by a test.
- **Mixed `["unchecked?","unrecognised?"]`**: unknown. Covered by a test.
- **Pretty-printed array**: `\s*` before the first string, `\s*` after each string, and `\s*` before `]` accept newlines between elements. The `\n` exclusion applies only inside string literals. OK.
- **Escaped quotes**: `(?:\\.|[^"\\\n])*` handles them, and `JSON.parse` decodes the value.
- **`]` or `,` inside a string**: the strict string grammar handles them. The old `[^\]]*` is only a pre-gate, and the strict regex decides. OK.
- **Non-string element or malformed array**: no match, `reasons === undefined`, returns unknown (conservative).
- **Budget-cut mid-array**: unknown (conservative). A cut body whose array holds only `unrecognised?` is still scored unknown. The only cost is some lost precision, never a false clean.
- **Closed array followed by `[reduced: …]` trailer**: the regex stops at the first `]`. OK. The trailer's `]` is not consumed, because string tokens cannot cross `]`.
- **`"census":"unknown"`**: still caught by `UNKNOWN_CENSUS`, independent of reasons. Covered by a test. The compact block keeps `census` whenever it is not `complete`.
- **Other `?`-suffixed strings near `reasons`**: only values inside the array are inspected. Keys such as `census` are not confused.
- **Multiple `"reasons"` keys**: only the first is read (finding 3).
- **`symbolHits` addition**: `ranked` is built from the same hits and the same file normalisation, so suite scoring is unchanged (finding 4).

## Decisions

- Carving out only `unrecognised?` (matching the user decision) is correctly implemented. `census: unknown` and the other `?` reasons remain unknown.
- Conservative-on-unparseable is the right default for the recorder.
- Do not approve until `searchSymbol` handles `Class.method` symbol names (finding 1).
- Ignore the non-listed items. Prettier and gate evidence were taken as given, and nothing was run.

## Re-review (revision 1)

Verdict: APPROVED — 8/10

Both substantive issues are fixed, and I found no false-clean in the classifier. Nothing was run; this is a read-only review of the diff and the executor report.

### Prior findings

1. **FIXED (was SERIOUS).**
   - `lifecycle-probe.ts:42-44` adds `matchesSymbolName`, which accepts `symbolName === name` or `symbolName.endsWith('.' + name)`. It is used at `lifecycle-probe.ts:83` together with the unchanged normalised-file equality. The real `ProviderSetupWizardComponent.onKeepEditing` shape is now found.
   - Matching stays case-sensitive. `onKeepEditingX` and `Other.onKeepEditingX` are rejected; the executor report cites specs for these at `lifecycle-probe.spec.ts:104-136`, which I did not open.
   - The suffix match also accepts a nested name such as `Foo.bar.onKeepEditing`. The indexer only emits `Class.method` (`code-symbol-indexer.service.ts:1496`), so nested names do not occur. A different class in the same file with the same method name would also match. That is acceptable: it is still a real indexed symbol in the expected file, and the scenario names written by the edit, add and large-file steps carry a unique per-run tag.
2. **FIXED (was MODERATE).**
   - `call-recorder.ts:158-181`: any array with three or more entries that contains `unrecognised?` is now unknown, because the server caps `reasons` at 3 and could hide a later `omitted?` or `resolution?`.
   - Side effect: a settled `updating` + `unchecked` + `unrecognised?` answer is now scored as unknown-coverage. That errs on the safe side (a false error, not a false clean). See new finding N1.
3. **FIXED (was MINOR).**
   - `call-recorder.ts:160-166`: `REASONS_START` and `REASONS_ARRAY` are both global, and every array is checked with `.some`. An earlier clean array can no longer mask a later unknown one.
   - If the number of array starts differs from the number of well-formed arrays (a cut or malformed array), the result is unknown. The strict array regex cannot cross a `]` inside a string, so the counts line up.
   - `matchAll` clones the regex, so the `/g` flag causes no `lastIndex` state bug.
4. **OPEN, accepted (MINOR).** `tool-results.ts:99-100` still throws when a hit has no string `symbolName`. Suite scoring is unchanged and the fallback path always supplies a string, so I accept this.
5. **MOSTLY FIXED (MINOR).**
   - Per the executor report, tests were added for the cap rule, multiple arrays, pretty-printed arrays, escaped quotes, a literal `]` or comma, the reduced trailer, and `Class.method` in `lifecycle-probe.spec.ts`. I did not open the revised specs.
   - Still missing: a case where the `[reduced: …]` trailer follows a closed array that holds only `unrecognised?` (the expected result is clean).

### New findings

- **N1, MINOR.** `call-recorder.ts:~178`: the three-entry rule over-fires when `updating`, `unchecked` and `unrecognised?` all appear. During reindex a settled answer can be scored as unknown, which may delay lifecycle polling by one iteration. This is conservative and not a correctness risk. If it proves noisy, narrow the rule so it triggers only when the array has exactly 3 entries and the third is `unrecognised?`.
- **N2, MINOR.** `lifecycle-probe.ts:43` has no guard for an empty `name`. `endsWith('.')` could match a symbol ending in a dot, which cannot occur in practice.

Counts: 0 blocking, 0 serious, 0 moderate, 2 minor (new), 1 minor open.
